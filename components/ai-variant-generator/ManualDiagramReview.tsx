import React, { useState, useEffect } from 'react';
import { QuestionModel } from '../../types';
import { uploadToStorage, generateUniqueFilename } from '../../services/storageService';
import { solveQuestionWithDiagram } from '../../services/geminiService';

interface ManualDiagramReviewProps {
    questions: QuestionModel[];
    onUpdateQuestion: (index: number, updates: Partial<QuestionModel>) => void;
    onClose: () => void;
    onApply: () => void;
}

const ManualDiagramReview: React.FC<ManualDiagramReviewProps> = ({
    questions,
    onUpdateQuestion,
    onClose,
    onApply
}) => {
    // Filter questions that actually need a diagram
    const reviewItems = questions
        .map((q, idx) => ({ question: q, originalIndex: idx }))
        .filter(item => item.question.needsManualDiagram);

    const [activeIndex, setActiveIndex] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [warningMessage, setWarningMessage] = useState<string | null>(null);

    const activeItem = reviewItems[activeIndex];

    useEffect(() => {
        if (reviewItems.length === 0) return;
        if (activeIndex >= reviewItems.length) {
            setActiveIndex(0);
        }
    }, [activeIndex, reviewItems.length]);

    const readFileAsDataUrl = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const finalizeMissingDiagrams = () => {
        reviewItems.forEach(item => {
            if (!item.question.diagramUrl) {
                onUpdateQuestion(item.originalIndex, { needsManualDiagram: false });
            }
        });
    };

    // Handle Clipboard Paste
    useEffect(() => {
        const handlePaste = async (event: ClipboardEvent) => {
            if (!activeItem) return;
            const items = event.clipboardData?.items;
            if (!items) return;

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    if (blob) {
                        await handleImageUpload(blob);
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [activeItem, activeIndex]);

    const handleImageUpload = async (file: File) => {
        if (!activeItem) return;
        setIsUploading(true);
        try {
            const filename = generateUniqueFilename('jpg');
            const url = await uploadToStorage(file, `diagrams/${filename}`);
            onUpdateQuestion(activeItem.originalIndex, {
                diagramUrl: url,
                needsManualDiagram: false // Mark as resolved
            });
            try {
                const dataUrl = await readFileAsDataUrl(file);
                const { result: solved, warning } = await solveQuestionWithDiagram(activeItem.question, dataUrl);
                if (warning) {
                    setWarningMessage(warning);
                }
                onUpdateQuestion(activeItem.originalIndex, {
                    ...solved,
                    diagramUrl: url,
                    needsManualDiagram: false
                });
            } catch (solveError) {
                console.error('Diagram solve failed:', solveError);
            }
        } catch (error) {
            console.error('Image upload failed:', error);
            alert('이미지 업로드에 실패했습니다.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleImageUpload(file);
        }
    };

    if (reviewItems.length === 0) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-lg text-center space-y-4">
                    <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                        수동으로 삽입할 도면이 없습니다.
                    </p>
                    <button
                        onClick={() => {
                            finalizeMissingDiagrams();
                            onClose();
                        }}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
                    >
                        닫기
                    </button>
                </div>
            </div>
        );
    }

    if (!activeItem) {
        return null;
    }

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4 py-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
                <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">
                            Step 2.5 · 도면 수동 삽입 (하이브리드)
                        </p>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">
                            그림/다이어그램 추가 ({activeIndex + 1}/{reviewItems.length})
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            AI가 감지한 그림 영역이 있습니다. 워드에서 그림을 복사(Ctrl+C)한 뒤 여기서 붙여넣기(Ctrl+V) 하세요.
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            finalizeMissingDiagrams();
                            onClose();
                        }}
                        className="text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    >
                        ✕
                    </button>
                </header>
                {warningMessage && (
                    <div className="px-6 py-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
                        {warningMessage}
                    </div>
                )}

                <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-x divide-slate-200 dark:divide-slate-700">
                    {/* Left: Question Content */}
                    <div className="w-full md:w-1/2 p-6 overflow-y-auto space-y-6">
                        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
                            <h4 className="text-sm font-bold text-indigo-800 dark:text-indigo-300 mb-2">문제 내용</h4>
                            <p className="text-base text-slate-800 dark:text-slate-100 whitespace-pre-line leading-relaxed">
                                {activeItem.question.questionText}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase mb-3 px-1">그림 대기 질문 목록</p>
                            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
                                {reviewItems.map((item, idx) => {
                                    const isDone = item.question.diagramUrl && !item.question.needsManualDiagram;
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => setActiveIndex(idx)}
                                            className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${idx === activeIndex
                                                ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/30'
                                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                                                }`}
                                        >
                                            <span className={`text-sm font-medium ${idx === activeIndex ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300'}`}>
                                                문항 #{item.originalIndex + 1}
                                            </span>
                                            {isDone ? (
                                                <span className="text-xs text-green-600 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full font-bold">완료</span>
                                            ) : (
                                                <span className="text-xs text-orange-600 bg-orange-50 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">대기</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Right: Upload/Paste Area */}
                    <div className="w-full md:w-1/2 p-6 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900/40">
                        {isUploading ? (
                            <div className="text-center space-y-3">
                                <div className="animate-spin text-4xl text-indigo-600">🌀</div>
                                <p className="text-sm text-slate-600 dark:text-slate-300">이미지를 업로드 중입니다...</p>
                            </div>
                        ) : activeItem.question.diagramUrl ? (
                            <div className="w-full h-full flex flex-col">
                                <p className="text-xs font-semibold text-slate-500 mb-2">업로드된 다이어그램</p>
                                <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center p-4">
                                    <img
                                        src={activeItem.question.diagramUrl}
                                        alt="Uploaded diagram"
                                        className="max-w-full max-h-full object-contain"
                                    />
                                </div>
                                <div className="mt-4 flex gap-2">
                                    <button
                                        onClick={() => onUpdateQuestion(activeItem.originalIndex, { diagramUrl: undefined, needsManualDiagram: true })}
                                        className="text-xs text-red-600 hover:underline"
                                    >
                                        이미지 삭제 후 다시 시도
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center space-y-6 max-w-sm px-4">
                                <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/40 rounded-full flex items-center justify-center mx-auto text-3xl">
                                    📸
                                </div>
                                <div>
                                    <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">여기에 붙여넣기 하세요</h4>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        클립보드에 복사된 이미지가 있다면 <kbd className="px-1.5 py-0.5 rounded border border-slate-300 bg-slate-100 text-xs font-bold">Ctrl + V</kbd>를 눌러 업로드하세요.
                                    </p>
                                </div>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-300 dark:border-slate-700"></div></div>
                                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-50 dark:bg-slate-900 px-2 text-slate-500">또는</span></div>
                                </div>

                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    id="manual-diagram-upload"
                                />
                                <label
                                    htmlFor="manual-diagram-upload"
                                    className="inline-block px-6 py-3 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold rounded-xl cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all shadow-sm"
                                >
                                    내 PC에서 이미지 선택
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between bg-white dark:bg-slate-900">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        {reviewItems.filter(item => item.question.diagramUrl).length} / {reviewItems.length} 완료됨
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                finalizeMissingDiagrams();
                                onClose();
                            }}
                            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300"
                        >
                            취소
                        </button>
                        <button
                            onClick={() => {
                                finalizeMissingDiagrams();
                                onApply();
                            }}
                            className="px-8 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-lg transition-all"
                        >
                            도면 삽입 완료 및 계속
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default ManualDiagramReview;
