import { supabase } from './supabaseClient';

const STORAGE_BUCKET = 'exam-assets';

/**
 * Upload a file to Supabase Storage
 * @param file - File to upload (image or text)
 * @param path - Storage path (e.g., 'images/uuid.jpg' or 'texts/uuid.txt')
 * @returns Public URL of the uploaded file
 */
export const uploadToStorage = async (file: File | Blob, path: string): Promise<string> => {

    const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
            cacheControl: '3600',
            upsert: false
        });

    if (error) {
        console.error('Storage upload error:', error);
        throw new Error(`Failed to upload file: ${error.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(data.path);

    return publicUrl;
};

/**
 * Upload base64 image to Supabase Storage
 * @param base64Image - Base64 encoded image (with or without data URL prefix)
 * @param filename - Filename to use (e.g., 'uuid.jpg')
 * @returns Public URL of the uploaded image
 */
export const uploadBase64Image = async (base64Image: string, filename: string): Promise<string> => {
    // Remove data URL prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

    // Convert base64 to blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/jpeg' });

    const path = `images/${filename}`;
    return uploadToStorage(blob, path);
};

/**
 * Upload text content to Supabase Storage as a file
 * @param textContent - Text content to upload
 * @param filename - Filename to use (e.g., 'uuid.txt')
 * @returns Public URL of the uploaded text file
 */
export const uploadTextFile = async (textContent: string, filename: string): Promise<string> => {
    const blob = new Blob([textContent], { type: 'text/plain' });
    const path = `texts/${filename}`;
    return uploadToStorage(blob, path);
};

/**
 * Upload diagram image to Supabase Storage
 * @param base64Image - Base64 encoded diagram image (with or without data URL prefix)
 * @param filename - Filename to use (e.g., 'uuid.jpg')
 * @returns Public URL of the uploaded diagram image
 */
export const uploadDiagramImage = async (base64Image: string, filename: string): Promise<string> => {
    // Remove data URL prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

    // Convert base64 to blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/jpeg' });

    const path = `diagrams/${filename}`;
    return uploadToStorage(blob, path);
};

/**
 * Generate a unique filename using timestamp and random string
 * @param extension - File extension (e.g., 'jpg', 'txt')
 * @returns Unique filename
 */
export const generateUniqueFilename = (extension: string): string => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}_${random}.${extension}`;
};
