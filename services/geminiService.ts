import { GoogleGenAI, Type } from "@google/genai";
import { Category } from "../types";

// In a real app, this would be properly secured.
const API_KEY = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey: API_KEY });

interface AnalysisResult {
  category: Category;
  name: string;
  color: string;
}

/**
 * Analyzes an uploaded image to determine clothing type and descriptive name.
 */
export const analyzeClothingImage = async (base64Image: string): Promise<AnalysisResult> => {
  if (!API_KEY) {
    console.warn("No API Key provided. Returning mock data.");
    return {
      category: 'TOP',
      name: 'Unidentified Item',
      color: 'Unknown'
    };
  }

  // Extract mime type dynamically
  const mimeMatch = base64Image.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  // Remove data URL prefix if present for the API call
  // Using a regex that matches the extracted mime type structure or generic base64 header
  const base64Data = base64Image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: "Analyze this image. Identify the primary clothing item. Classify it into one of these categories: TOP, BOTTOM, DRESS, ACCESSORY. Provide a short name (max 3 words) and the primary color."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: ['TOP', 'BOTTOM', 'DRESS', 'ACCESSORY', 'UNKNOWN'],
              description: "The category of the clothing item."
            },
            name: {
              type: Type.STRING,
              description: "A short descriptive name (e.g., 'Blue Denim Jacket')."
            },
            color: {
              type: Type.STRING,
              description: "The dominant color of the item."
            }
          },
          required: ['category', 'name', 'color']
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    
    return JSON.parse(text) as AnalysisResult;

  } catch (error) {
    console.error("Gemini analysis failed:", error);
    // Fallback
    return {
      category: 'TOP',
      name: 'New Item',
      color: 'Mixed'
    };
  }
};