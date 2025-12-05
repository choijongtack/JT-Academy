import * as pdfjsLib from 'pdfjs-dist';

// Define the structure for extracted images
export interface ExtractedImage {
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    dataUrl: string; // Base64 encoded image
    id: string; // Unique ID for the image
}

export interface PdfQuestionAnchor {
    questionNumber: number;
    y: number;
}

export interface PdfPageText {
    pageIndex: number;
    text: string;
    questionAnchors: PdfQuestionAnchor[];
    width: number;
    height: number;
}

type PdfInput = File | ArrayBuffer | Uint8Array;

interface PdfPageRange {
    start?: number;
    end?: number;
}

const getPdfDocument = async (source: PdfInput) => {
    if (source instanceof File) {
        const buffer = await source.arrayBuffer();
        return await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    }

    if (source instanceof Uint8Array) {
        const cloned = source.slice();
        return await pdfjsLib.getDocument({ data: cloned }).promise;
    }

    const data = new Uint8Array(source);
    return await pdfjsLib.getDocument({ data }).promise;
};

const resolvePageBounds = (pageCount: number, range?: PdfPageRange) => {
    if (!range) {
        return { start: 1, end: pageCount };
    }
    const start = Math.max(1, Math.min(range.start ?? 1, pageCount));
    const end = Math.max(start, Math.min(range.end ?? pageCount, pageCount));
    return { start, end };
};

export const extractImagesFromPdf = async (file: PdfInput, pageRange?: PdfPageRange): Promise<ExtractedImage[]> => {
    const pdf = await getPdfDocument(file);
    const bounds = resolvePageBounds(pdf.numPages, pageRange);
    const extractedImages: ExtractedImage[] = [];

    for (let pageNum = bounds.start; pageNum <= bounds.end; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const operatorList = await page.getOperatorList();
        const viewport = page.getViewport({ scale: 1.0 }); // Use scale 1.0 for coordinate normalization

        const { fnArray, argsArray } = operatorList;

        let currentMatrix = [1, 0, 0, 1, 0, 0]; // Identity matrix
        const matrixStack: number[][] = [];

        for (let i = 0; i < fnArray.length; i++) {
            const fn = fnArray[i];
            const args = argsArray[i];

            if (fn === pdfjsLib.OPS.save) { // q
                matrixStack.push([...currentMatrix]);
            } else if (fn === pdfjsLib.OPS.restore) { // Q
                if (matrixStack.length > 0) {
                    currentMatrix = matrixStack.pop()!;
                }
            } else if (fn === pdfjsLib.OPS.transform) { // cm
                // args: [a, b, c, d, e, f]
                // Multiply currentMatrix * args
                const [a, b, c, d, e, f] = args;
                const [m0, m1, m2, m3, m4, m5] = currentMatrix;

                currentMatrix = [
                    m0 * a + m2 * b,
                    m1 * a + m3 * b,
                    m0 * c + m2 * d,
                    m1 * c + m3 * d,
                    m0 * e + m2 * f + m4,
                    m1 * e + m3 * f + m5
                ];
            } else if (fn === pdfjsLib.OPS.paintImageXObject) {
                const imgName = args[0];
                try {
                    // Retrieve the image object
                    let imgObj: any;
                    // @ts-ignore
                    if (page.objs.get) {
                        // @ts-ignore
                        imgObj = await new Promise(resolve => page.objs.get(imgName, resolve));
                    } else {
                        // @ts-ignore
                        imgObj = page.objs[imgName];
                    }

                    if (imgObj && (imgObj.data || imgObj.bitmap)) {
                        // Calculate bounding box in Viewport space
                        const p00 = applyMatrix(currentMatrix, [0, 0]);
                        const p11 = applyMatrix(currentMatrix, [1, 1]);
                        const p10 = applyMatrix(currentMatrix, [1, 0]);
                        const p01 = applyMatrix(currentMatrix, [0, 1]);

                        const vp00 = viewport.convertToViewportPoint(p00[0], p00[1]);
                        const vp11 = viewport.convertToViewportPoint(p11[0], p11[1]);
                        const vp10 = viewport.convertToViewportPoint(p10[0], p10[1]);
                        const vp01 = viewport.convertToViewportPoint(p01[0], p01[1]);

                        const minX = Math.min(vp00[0], vp11[0], vp10[0], vp01[0]);
                        const maxX = Math.max(vp00[0], vp11[0], vp10[0], vp01[0]);
                        const minY = Math.min(vp00[1], vp11[1], vp10[1], vp01[1]);
                        const maxY = Math.max(vp00[1], vp11[1], vp10[1], vp01[1]);

                        // Convert image data to Base64
                        const dataUrl = await imageToDataUrl(imgObj);

                        if (dataUrl) {
                            extractedImages.push({
                                pageIndex: pageNum - 1, // 0-indexed
                                x: minX,
                                y: minY,
                                width: maxX - minX,
                                height: maxY - minY,
                                dataUrl,
                                id: `${pageNum}_${imgName}`
                            });
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to extract image ${imgName} on page ${pageNum}`, e);
                }
            }
        }
    }

    pdf.cleanup?.();
    pdf.destroy?.();
    return extractedImages;
};

export const extractStructuredTextFromPdf = async (file: PdfInput, pageRange?: PdfPageRange): Promise<PdfPageText[]> => {
    const pdf = await getPdfDocument(file);
    const bounds = resolvePageBounds(pdf.numPages, pageRange);
    const results: PdfPageText[] = [];

    for (let pageNum = bounds.start; pageNum <= bounds.end; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();

        const parts: string[] = [];
        const anchors: PdfQuestionAnchor[] = [];

        textContent.items.forEach((item: any) => {
            if (!item || typeof item.str !== 'string') {
                return;
            }

            const value = item.str;
            parts.push(value);
            if (item.hasEOL) {
                parts.push('\n');
            } else {
                parts.push(' ');
            }

            const trimmed = value.trim();
            const match = trimmed.match(/^(\d{1,3})\./);
            if (match) {
                const questionNumber = parseInt(match[1], 10);
                if (!Number.isNaN(questionNumber)) {
                    const transformed = pdfjsLib.Util.transform(
                        viewport.transform,
                        item.transform
                    );
                    const [vx, vy] = viewport.convertToViewportPoint(transformed[4], transformed[5]);
                    anchors.push({ questionNumber, y: vy });
                }
            }
        });

        const rawText = parts.join('')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+\n/g, '\n')
            .replace(/\n\s+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        results.push({
            pageIndex: pageNum - 1,
            text: rawText,
            questionAnchors: anchors,
            width: viewport.width,
            height: viewport.height
        });
    }

    pdf.cleanup?.();
    pdf.destroy?.();
    return results;
};

// Helper to apply matrix
function applyMatrix(m: number[], p: number[]) {
    return [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5]
    ];
}

// Helper to convert PDF image object to Data URL
async function imageToDataUrl(imgObj: any): Promise<string | null> {
    // If it's an ImageBitmap (modern browsers/pdf.js)
    if (imgObj.bitmap) {
        const canvas = document.createElement('canvas');
        canvas.width = imgObj.width;
        canvas.height = imgObj.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(imgObj.bitmap, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.9);
    }

    if (!imgObj.data) return null;

    const width = imgObj.width;
    const height = imgObj.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageData = ctx.createImageData(width, height);

    // Handle different image kinds
    // 1: Grayscale, 2: RGB, 3: RGBA
    // Note: This is a simplification. PDF.js has more complex handling.
    if (imgObj.kind === 2) { // RGB
        const src = imgObj.data;
        const dest = imageData.data;
        let j = 0;
        for (let i = 0; i < src.length; i += 3) {
            dest[j++] = src[i];     // R
            dest[j++] = src[i + 1]; // G
            dest[j++] = src[i + 2]; // B
            dest[j++] = 255;        // A
        }
    } else if (imgObj.kind === 1) { // Grayscale
        const src = imgObj.data;
        const dest = imageData.data;
        let j = 0;
        for (let i = 0; i < src.length; i++) {
            const val = src[i];
            dest[j++] = val;
            dest[j++] = val;
            dest[j++] = val;
            dest[j++] = 255;
        }
    } else if (imgObj.kind === 3) { // RGBA
        imageData.data.set(imgObj.data);
    } else {
        // Try to guess or fallback
        // If data length == width * height * 3 -> RGB
        if (imgObj.data.length === width * height * 3) {
            const src = imgObj.data;
            const dest = imageData.data;
            let j = 0;
            for (let i = 0; i < src.length; i += 3) {
                dest[j++] = src[i];
                dest[j++] = src[i + 1];
                dest[j++] = src[i + 2];
                dest[j++] = 255;
            }
        } else if (imgObj.data.length === width * height) {
            const src = imgObj.data;
            const dest = imageData.data;
            let j = 0;
            for (let i = 0; i < src.length; i++) {
                const val = src[i];
                dest[j++] = val;
                dest[j++] = val;
                dest[j++] = val;
                dest[j++] = 255;
            }
        } else if (imgObj.data.length === width * height * 4) {
            imageData.data.set(imgObj.data);
        } else {
            return null;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
}
