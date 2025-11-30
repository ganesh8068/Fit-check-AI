export type Category = 'TOP' | 'BOTTOM' | 'DRESS' | 'ACCESSORY' | 'UNKNOWN';

export interface ClothingItem {
  id: string;
  imageUrl: string;
  category: Category;
  name: string;
  timestamp: number;
}

export interface PlacedItem extends ClothingItem {
  // Manual adjustments
  scale: number;
  rotation: number; // in degrees
  offsetX: number;
  offsetY: number;
}

export interface Outfit {
  id: string;
  name: string;
  items: ClothingItem[];
  thumbnailUrl?: string;
}

export interface VisionTaskResult {
  landmarks: { x: number; y: number; z: number; visibility: number }[];
}
