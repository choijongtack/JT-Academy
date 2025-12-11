
import { useState, useRef, ChangeEvent } from 'react';
import { quizApi } from '../../services/quizApi';
import { uploadToStorage, generateUniqueFilename } from '../../services/storageService';
import { buildStandardStoragePath, chunkStandardPages, StandardPageEntry } from './utils';
import { extractTextFromImages } from '../../services/geminiService';
import * as pdfjsLib from 'pdfjs-dist';

// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export const useStandardUpload = ({
    certification,
    selectedSubject
}: {
    certification: string;
    selectedSubject: string | null;
}) => {
    const [standardFiles, setStandardFiles] = useState<File[]>([]);
    const [isUploadingStandard, setIsUploadingStandard] = useState(false);

    const handleStandardFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) return;

        const incomingFiles = Array.from(event.target.files) as File[];
        const validFiles = incomingFiles.filter(
            (file) => file.type === 'application/pdf' || file.type.startsWith('image/')
        );

        if (validFiles.length !== incomingFiles.length) {
            alert('PDF 또는 이미지 파일만 업로드할 수 있습니다.');
        }

        if (validFiles.length > 0) {
            setStandardFiles((prev) => [...prev, ...validFiles]);
        }

        event.target.value = '';
    };

    const removeStandardFile = (index: number) => {
        setStandardFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleUploadStandard = async () => {
        if (standardFiles.length === 0 || !selectedSubject) {
            alert('출제 기준 파일과 과목을 선택해주세요.');
            return;
        }

        setIsUploadingStandard(true);
        try {
            const pages: StandardPageEntry[] = [];
            const filesMeta: {
                url: string;
                originalFilename: string;
                fileType: string;
                fileSize: number;
                pageCount: number | null;
            }[] = [];
            let nextPageNumber = 1;

            for (const file of standardFiles) {
                const extension = file.name.split('.').pop()?.toLowerCase()
                    || (file.type === 'application/pdf' ? 'pdf' : 'bin');
                const storageFilename = generateUniqueFilename(extension);
                const storagePath = buildStandardStoragePath(certification, selectedSubject, storageFilename);
                const fileUrl = await uploadToStorage(file, storagePath);

                if (file.type === 'application/pdf') {
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        let pageText = textContent.items.map((item: any) => item.str).join(' ').trim();

                        if (pageText) {
                            pages.push({
                                pageNumber: nextPageNumber,
                                text: pageText
                            });
                        }
                        nextPageNumber++;
                    }

                    filesMeta.push({
                        url: fileUrl,
                        originalFilename: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        pageCount: pdf.numPages
                    });
                } else if (file.type.startsWith('image/')) {
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });

                    const ocrText = await extractTextFromImages([base64]);
                    const segments = ocrText
                        .split(/---PAGE BREAK---/i)
                        .map(segment => segment.trim())
                        .filter(segment => segment.length > 0);
                    const effectiveSegments = segments.length > 0
                        ? segments
                        : (ocrText.trim() ? [ocrText.trim()] : []);

                    effectiveSegments.forEach(segment => {
                        pages.push({
                            pageNumber: nextPageNumber,
                            text: segment
                        });
                        nextPageNumber++;
                    });

                    if (effectiveSegments.length === 0) {
                        nextPageNumber++;
                    }

                    filesMeta.push({
                        url: fileUrl,
                        originalFilename: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        pageCount: effectiveSegments.length || 1
                    });
                }
            }

            const sortedPages = pages.sort((a, b) => a.pageNumber - b.pageNumber);
            const fullText = sortedPages
                .map(page => `# Page ${page.pageNumber}\n${page.text}`)
                .join('\n\n');

            const sections = chunkStandardPages(sortedPages).map(section => ({
                sectionIndex: section.sectionIndex,
                startPage: section.startPage,
                endPage: section.endPage,
                content: section.content,
                charCount: section.charCount,
                tokenEstimate: section.tokenEstimate
            }));

            await quizApi.saveCertificationStandard({
                certification,
                subject: selectedSubject,
                pdfUrl: filesMeta[0]?.url || '',
                extractedText: fullText,
                files: filesMeta,
                sections
            });

            alert('출제 기준이 성공적으로 저장되었습니다.');
            setStandardFiles([]);
        } catch (error) {
            console.error('Error saving standard:', error);
            const message = error instanceof Error ? error.message : '알 수 없는 오류입니다.';
            alert(`출제 기준 저장 중 오류가 발생했습니다.\n${message}`);
        } finally {
            setIsUploadingStandard(false);
        }
    };

    return {
        standardFiles,
        isUploadingStandard,
        handleStandardFileChange,
        removeStandardFile,
        handleUploadStandard
    };
};
