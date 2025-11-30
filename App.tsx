import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Shirt, Upload, Save, Menu, X, Check, RefreshCcw, Video, Download, Trash2, Plus, GripVertical, AlertCircle } from 'lucide-react';
import { usePoseTracker } from './hooks/usePoseTracker';
import { analyzeClothingImage } from './services/geminiService';
import { ClothingItem, PlacedItem, Category } from './types';

// --- Constants ---
const LANDMARK_LEFT_SHOULDER = 11;
const LANDMARK_RIGHT_SHOULDER = 12;
const LANDMARK_LEFT_HIP = 23;
const LANDMARK_RIGHT_HIP = 24;

export default function App() {
  // --- State ---
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  // Clothing State
  const [closet, setCloset] = useState<ClothingItem[]>([]);
  const [queue, setQueue] = useState<ClothingItem[]>([]);
  const [activeItems, setActiveItems] = useState<PlacedItem[]>([]);
  
  // UI State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const requestRef = useRef<number>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeItemImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Logic Hooks
  const { poseLandmarker, isLoading: isModelLoading } = usePoseTracker();

  // --- Initialization ---

  // Load Closet from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('vf_closet');
    if (saved) {
      try {
        setCloset(JSON.parse(saved));
      } catch (e) { console.error("Failed to load closet", e); }
    }
  }, []);

  // Save Closet
  useEffect(() => {
    localStorage.setItem('vf_closet', JSON.stringify(closet));
  }, [closet]);

  // Start Camera
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 }, 
            height: { ideal: 720 },
            facingMode: 'user' 
          },
          audio: false 
        });
        setVideoStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (err) {
        setCameraError("Unable to access camera. Please allow permissions.");
      }
    };
    startCamera();
  }, []);

  // --- Logic: Image Processing ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      
      // Call Gemini for smart analysis
      const analysis = await analyzeClothingImage(base64);
      
      const newItem: ClothingItem = {
        id: crypto.randomUUID(),
        imageUrl: base64,
        category: analysis.category,
        name: analysis.name,
        timestamp: Date.now()
      };

      setCloset(prev => [newItem, ...prev]);
      setQueue(prev => [...prev, newItem]);
      
      // Preload image for canvas
      const img = new Image();
      img.src = base64;
      activeItemImagesRef.current.set(newItem.id, img);
      
      setIsProcessing(false);
    };
    reader.readAsDataURL(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTryOn = () => {
    // Convert queue items to placed items with default settings
    const newPlacedItems: PlacedItem[] = queue.map(item => ({
      ...item,
      scale: 1.0,
      rotation: 0,
      offsetX: 0,
      offsetY: 0
    }));
    setActiveItems(newPlacedItems);
    setIsMenuOpen(false);
  };

  const clearActive = () => {
    setActiveItems([]);
    setQueue([]);
  };

  // --- Logic: Recording ---

  const toggleRecording = () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      if (!canvasRef.current) return;
      
      // Record the CANVAS stream, not just the video
      const stream = canvasRef.current.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          setRecordedChunks(prev => [...prev, e.data]);
        }
      };
      
      recorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `virtual-fit-${Date.now()}.webm`;
        a.click();
        setRecordedChunks([]);
      };
      
      recorder.start();
      setIsRecording(true);
      setRecordedChunks([]); // clear previous
    }
  };

  // --- Logic: The Render Loop ---

  const renderLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Safety checks before processing
    if (video && canvas && poseLandmarker) {
      // Ensure video has loaded data and has dimensions
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // 1. Setup Canvas
          if (canvas.width !== video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
          }

          // 2. Draw Video Background
          ctx.save();
          // Mirror the video to feel like a mirror
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          // 3. Detect Pose
          const startTimeMs = performance.now();
          let result = null;
          try {
             result = poseLandmarker.detectForVideo(video, startTimeMs);
          } catch (error) {
             // Suppress momentary tracking errors to prevent crash loop
             console.debug("Pose tracking skipped frame:", error);
          }

          // 4. Draw Clothes
          if (result && result.landmarks && result.landmarks.length > 0) {
            const landmarks = result.landmarks[0]; // First detected person
            
            // Calculate Body Metrics
            const leftShoulder = landmarks[LANDMARK_LEFT_SHOULDER];
            const rightShoulder = landmarks[LANDMARK_RIGHT_SHOULDER];
            const leftHip = landmarks[LANDMARK_LEFT_HIP];
            const rightHip = landmarks[LANDMARK_RIGHT_HIP];

            // Mirror x coordinates because we mirrored the canvas draw
            
            const shoulderWidth = Math.sqrt(
              Math.pow((leftShoulder.x - rightShoulder.x) * canvas.width, 2) +
              Math.pow((leftShoulder.y - rightShoulder.y) * canvas.height, 2)
            );

            // Torso Angle (for rotation) - atan2(dy, dx)
            const angleRad = Math.atan2(
              rightShoulder.y - leftShoulder.y,
              rightShoulder.x - leftShoulder.x
            ); 
            
            // Center Points
            const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
            const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
            const hipCenterX = (leftHip.x + rightHip.x) / 2;
            const hipCenterY = (leftHip.y + rightHip.y) / 2;

            activeItems.forEach(item => {
              const img = activeItemImagesRef.current.get(item.id);
              if (!img) {
                 // Lazy load if missing from ref (edge case)
                 const newImg = new Image();
                 newImg.src = item.imageUrl;
                 activeItemImagesRef.current.set(item.id, newImg);
                 return; 
              }

              // Determine Anchor Point
              let anchorX = shoulderCenterX;
              let anchorY = shoulderCenterY;
              let baseScale = shoulderWidth * 2.5; // Heuristic: Shirt is ~2.5x detected shoulder width

              if (item.category === 'BOTTOM') {
                anchorX = hipCenterX;
                anchorY = hipCenterY;
                baseScale = shoulderWidth * 1.8;
              } else if (item.category === 'DRESS') {
                // Between shoulders and hips but higher
                anchorY = shoulderCenterY + (hipCenterY - shoulderCenterY) * 0.2; 
              }

              // Apply transformations
              const finalWidth = baseScale * item.scale;
              const aspectRatio = img.naturalWidth / img.naturalHeight;
              const finalHeight = finalWidth / aspectRatio;

              // Render
              ctx.save();
              
              // Handle Mirroring Logic:
              // The video is drawn mirrored. We want the clothes to follow the mirrored body.
              // If landmark.x is 0.2 (left side of source), in mirrored view it is displayed at 0.8.
              // We should translate to (1 - anchorX) * width.
              
              const screenX = (1 - anchorX) * canvas.width + item.offsetX;
              const screenY = anchorY * canvas.height + item.offsetY;

              ctx.translate(screenX, screenY);
              
              // Apply body rotation + manual rotation
              ctx.rotate(-angleRad + (item.rotation * Math.PI / 180));

              // Draw Centered
              ctx.drawImage(img, -finalWidth / 2, -finalHeight / 2, finalWidth, finalHeight);

              ctx.restore();
            });
          }
        }
      }
    }
    requestRef.current = requestAnimationFrame(renderLoop);
  }, [poseLandmarker, activeItems]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [renderLoop]);

  // --- Interaction: Gestures (Simple version) ---

  const updateItemTransform = (deltaScale: number, deltaRot: number, deltaX: number, deltaY: number) => {
    if (activeItems.length === 0) return;
    // Modify the last item (topmost)
    const index = activeItems.length - 1;
    const item = activeItems[index];
    
    const updated = [...activeItems];
    updated[index] = {
      ...item,
      scale: Math.max(0.1, item.scale + deltaScale),
      rotation: item.rotation + deltaRot,
      offsetX: item.offsetX + deltaX,
      offsetY: item.offsetY + deltaY
    };
    setActiveItems(updated);
  };


  return (
    <div className="relative w-screen h-screen bg-dark text-white overflow-hidden flex flex-col">
      {/* Hidden Video Source */}
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Main Canvas Stage */}
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full object-cover z-0"
      />

      {/* Loading Overlay */}
      {(isModelLoading || !videoStream) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-300">{cameraError || "Initializing AI Model..."}</p>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-20 pointer-events-none">
        {/* Hamburger */}
        <button 
          onClick={() => setIsMenuOpen(true)}
          className="pointer-events-auto bg-surface/50 backdrop-blur-md p-3 rounded-full hover:bg-surface transition-colors"
        >
          <Menu className="w-6 h-6 text-white" />
        </button>

        {/* Recording Indicator */}
        {isRecording && (
          <div className="flex items-center gap-2 bg-red-500/80 px-4 py-2 rounded-full animate-pulse">
            <div className="w-3 h-3 bg-white rounded-full"></div>
            <span className="font-bold text-sm">REC</span>
          </div>
        )}
      </div>

      {/* Right Side: Queue */}
      <div className={`absolute top-0 right-0 h-full w-24 bg-surface/30 backdrop-blur-sm transition-transform duration-300 z-20 flex flex-col pt-20 pb-4 items-center gap-3 ${queue.length === 0 ? 'translate-x-full' : 'translate-x-0'}`}>
        {queue.map((item, idx) => (
          <div key={item.id} className="relative group pointer-events-auto">
            <img 
              src={item.imageUrl} 
              alt={item.name} 
              className="w-16 h-16 rounded-lg object-cover border-2 border-accent shadow-lg bg-white/10"
            />
            <button 
              onClick={() => {
                setQueue(queue.filter(i => i.id !== item.id));
              }}
              className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Controls Overlay (Bottom) */}
      <div className="absolute bottom-0 left-0 w-full p-6 pb-10 z-30 flex flex-col gap-4 pointer-events-none">
        
        {/* Adjustment Controls (Only show if items actve) */}
        {activeItems.length > 0 && (
          <div className="self-center flex gap-6 pointer-events-auto bg-surface/60 backdrop-blur-md px-6 py-3 rounded-2xl mb-2">
            <div className="flex flex-col items-center gap-1">
               <span className="text-[10px] uppercase tracking-wider text-gray-400">Move</span>
               <div className="grid grid-cols-3 gap-1">
                 <div />
                 <button onClick={() => updateItemTransform(0, 0, 0, -10)} className="p-2 bg-black/40 rounded hover:bg-accent"><GripVertical className="rotate-90 w-4 h-4"/></button>
                 <div />
                 <button onClick={() => updateItemTransform(0, 0, -10, 0)} className="p-2 bg-black/40 rounded hover:bg-accent"><GripVertical className="rotate-180 w-4 h-4"/></button>
                 <div className="w-8 h-8 flex items-center justify-center"><GripVertical className="w-4 h-4 text-gray-500"/></div>
                 <button onClick={() => updateItemTransform(0, 0, 10, 0)} className="p-2 bg-black/40 rounded hover:bg-accent"><GripVertical className="w-4 h-4"/></button>
                 <div />
                 <button onClick={() => updateItemTransform(0, 0, 0, 10)} className="p-2 bg-black/40 rounded hover:bg-accent"><GripVertical className="-rotate-90 w-4 h-4"/></button>
                 <div />
               </div>
            </div>

            <div className="w-px bg-gray-600 mx-2"></div>

            <div className="flex flex-col items-center justify-center gap-2">
               <span className="text-[10px] uppercase tracking-wider text-gray-400">Scale</span>
               <div className="flex gap-2">
                  <button onClick={() => updateItemTransform(-0.1, 0, 0, 0)} className="p-3 bg-black/40 rounded-full hover:bg-accent">-</button>
                  <button onClick={() => updateItemTransform(0.1, 0, 0, 0)} className="p-3 bg-black/40 rounded-full hover:bg-accent">+</button>
               </div>
            </div>

             <div className="w-px bg-gray-600 mx-2"></div>

            <div className="flex flex-col items-center justify-center gap-2">
               <span className="text-[10px] uppercase tracking-wider text-gray-400">Rotate</span>
               <div className="flex gap-2">
                  <button onClick={() => updateItemTransform(0, -5, 0, 0)} className="p-3 bg-black/40 rounded-full hover:bg-accent"><RefreshCcw className="w-4 h-4 -scale-x-100"/></button>
                  <button onClick={() => updateItemTransform(0, 5, 0, 0)} className="p-3 bg-black/40 rounded-full hover:bg-accent"><RefreshCcw className="w-4 h-4"/></button>
               </div>
            </div>
          </div>
        )}

        {/* Main Buttons */}
        <div className="flex items-center justify-between w-full max-w-md mx-auto pointer-events-auto">
           {/* Add Item */}
           <div className="relative">
             <input 
               type="file" 
               ref={fileInputRef}
               accept="image/*" 
               onChange={handleFileUpload}
               className="hidden" 
               id="file-upload"
             />
             <label 
               htmlFor="file-upload" 
               className={`flex flex-col items-center justify-center w-16 h-16 rounded-full ${isProcessing ? 'bg-gray-600' : 'bg-surface hover:bg-gray-700'} text-white shadow-lg cursor-pointer transition-all border border-gray-600`}
             >
               {isProcessing ? <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"/> : <Plus size={28} />}
             </label>
             <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-400 whitespace-nowrap">Add Item</span>
           </div>

           {/* Try On / Reset Action */}
           {activeItems.length > 0 ? (
              <button 
                onClick={clearActive}
                className="flex items-center justify-center w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-2xl shadow-red-500/20 transform hover:scale-105 transition-all"
              >
                <X size={32} />
              </button>
           ) : (
             <button 
               onClick={handleTryOn}
               disabled={queue.length === 0}
               className={`flex items-center justify-center w-20 h-20 rounded-full shadow-2xl transform transition-all ${
                 queue.length > 0 
                 ? 'bg-accent hover:bg-blue-600 hover:scale-105 shadow-accent/40' 
                 : 'bg-gray-700 text-gray-500 cursor-not-allowed'
               }`}
             >
               <Shirt size={32} fill={queue.length > 0 ? "currentColor" : "none"} />
             </button>
           )}

           {/* Record */}
           <div className="relative">
            <button 
                onClick={toggleRecording}
                className={`flex flex-col items-center justify-center w-16 h-16 rounded-full border border-gray-600 ${isRecording ? 'bg-white text-red-500' : 'bg-surface hover:bg-gray-700 text-white'} shadow-lg transition-all`}
              >
                {isRecording ? <div className="w-6 h-6 bg-red-500 rounded-sm" /> : <Video size={24} />}
              </button>
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-400 whitespace-nowrap">
                {isRecording ? 'Stop' : 'Record'}
              </span>
           </div>
        </div>
      </div>

      {/* Hamburger Menu Drawer */}
      {isMenuOpen && (
        <div className="absolute inset-0 z-40 flex pointer-events-auto">
          <div className="w-80 h-full bg-[#121212] border-r border-gray-800 flex flex-col shadow-2xl animate-in slide-in-from-left duration-300">
            <div className="p-6 border-b border-gray-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white tracking-tight">Your Closet</h2>
              <button onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white">
                <X />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Saved Items</h3>
              <div className="grid grid-cols-2 gap-4">
                {closet.length === 0 ? (
                  <div className="col-span-2 text-center py-10 text-gray-600">
                    <p>No items yet.</p>
                    <p className="text-sm">Upload photos to build your closet.</p>
                  </div>
                ) : (
                  closet.map(item => (
                    <div 
                      key={item.id} 
                      className="bg-surface rounded-xl overflow-hidden group cursor-pointer border border-transparent hover:border-accent transition-all"
                      onClick={() => {
                        setQueue(prev => [...prev, item]);
                        setIsMenuOpen(false);
                      }}
                    >
                      <div className="aspect-square relative">
                        <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.name} />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Plus className="text-white" />
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="font-medium text-sm truncate">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.category}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-800">
               <button 
                  onClick={() => {
                    localStorage.removeItem('vf_closet');
                    setCloset([]);
                  }}
                  className="flex items-center justify-center gap-2 w-full py-3 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                  Clear All Data
               </button>
            </div>
          </div>
          {/* Backdrop */}
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)} />
        </div>
      )}
    </div>
  );
}