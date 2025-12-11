import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QuestionModel } from '../../types';
import { PagePreview, SubjectProcessingPackage } from './utils';

type DiagramBounds = { x: number; y: number; width: number; height: number; };
type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
interface DragState {
    handle: DragHandle;
    startX: number;
    startY: number;
    scale: number;
    questionIndex: number;
    initialBounds: DiagramBounds;
}

interface DiagramReviewModalProps {
    subjectName: string;
    questions: QuestionModel[];
    diagramAssignments: SubjectProcessingPackage['questionDiagramMap'];
    pagePreviews: PagePreview[];
    onClose: () => void;
    onApply: (updatedAssignments: SubjectProcessingPackage['questionDiagramMap']) => void;
}

const MIN_CROP_SIZE = 24;
const handleOrder: DragHandle[] = ['nw', 'ne', 'sw', 'se'];

const sanitizeNumber = (value: number | undefined, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return value;
};

const sanitizeBounds = (bounds?: DiagramBounds): DiagramBounds => {
    return {
        x: sanitizeNumber(bounds?.x, 0),
        y: sanitizeNumber(bounds?.y, 0),
        width: sanitizeNumber(bounds?.width, MIN_CROP_SIZE),
        height: sanitizeNumber(bounds?.height, MIN_CROP_SIZE),
    };
};

const applyHandleDelta = (initial: DiagramBounds, handle: DragHandle, deltaX: number, deltaY: number): DiagramBounds => {
    if (handle === 'move') {
        return {
            x: initial.x + deltaX,
            y: initial.y + deltaY,
            width: initial.width,
            height: initial.height
        };
    }
    let x = initial.x;
    let y = initial.y;
    let width = initial.width;
    let height = initial.height;

    if (handle.includes('w')) {
        x = initial.x + deltaX;
        width = initial.width - deltaX;
    }
    if (handle.includes('e')) {
        width = initial.width + deltaX;
    }
    if (handle.includes('n')) {
        y = initial.y + deltaY;
        height = initial.height - deltaY;
    }
    if (handle.includes('s')) {
        height = initial.height + deltaY;
    }

    if (handle.includes('w') && width <= MIN_CROP_SIZE) {
        x = initial.x + (initial.width - MIN_CROP_SIZE);
        width = MIN_CROP_SIZE;
    }
    if (!handle.includes('w')) {
        width = Math.max(MIN_CROP_SIZE, width);
    }
    if (handle.includes('n') && height <= MIN_CROP_SIZE) {
        y = initial.y + (initial.height - MIN_CROP_SIZE);
        height = MIN_CROP_SIZE;
    }
    if (!handle.includes('n')) {
        height = Math.max(MIN_CROP_SIZE, height);
    }

    return { x, y, width, height };
};

const DiagramReviewModal: React.FC<DiagramReviewModalProps> = ({
    subjectName,
    questions,
    diagramAssignments,
    pagePreviews,
    onClose,
    onApply
}) => {
    const previewMap = useMemo(() => {
        const map = new Map<number, PagePreview>();
        pagePreviews.forEach(preview => map.set(preview.pageIndex, preview));
        return map;
    }, [pagePreviews]);

    const sortedAssignments = useMemo(() => {
        return [...diagramAssignments].sort((a, b) => a[0] - b[0]);
    }, [diagramAssignments]);

    const reviewItems = useMemo(() => {
        return sortedAssignments
            .map(([questionIndex, info]) => {
                const question = questions[questionIndex];
                if (!question) return null;
                return { questionIndex, info, question };
            })
            .filter((item): item is { questionIndex: number; info: { pageIndex: number; bounds: DiagramBounds }; question: QuestionModel } => Boolean(item));
    }, [questions, sortedAssignments]);

    const pageIndexMap = useMemo(() => {
        const map = new Map<number, number>();
        diagramAssignments.forEach(([index, info]) => map.set(index, info.pageIndex));
        return map;
    }, [diagramAssignments]);

    const [boundsByQuestion, setBoundsByQuestion] = useState<Map<number, DiagramBounds>>(() => {
        return new Map(diagramAssignments.map(([idx, info]) => [idx, sanitizeBounds(info.bounds)]));
    });
    useEffect(() => {
        setBoundsByQuestion(new Map(diagramAssignments.map(([idx, info]) => [idx, sanitizeBounds(info.bounds)])));
    }, [diagramAssignments]);

    const [activeIndex, setActiveIndex] = useState(0);
    useEffect(() => {
        setActiveIndex(0);
    }, [diagramAssignments]);

    const [zoom, setZoom] = useState(1);
    useEffect(() => {
        setZoom(1);
    }, [activeIndex]);

    const [dragState, setDragState] = useState<DragState | null>(null);
    const [naturalSizes, setNaturalSizes] = useState<Map<number, { width: number; height: number }>>(() => new Map());

    const activeItem = reviewItems[activeIndex] || reviewItems[0];
    const activeBounds = activeItem ? boundsByQuestion.get(activeItem.questionIndex) || activeItem.info.bounds : null;
    const activePreview = activeItem ? previewMap.get(activeItem.info.pageIndex) : null;
    const previewSrc = activePreview?.dataUrl || activePreview?.imageUrl || '';
    const activeQuestionNumber = activeItem ? activeItem.questionIndex + 1 : 0;

    const clampBoundsToPage = useCallback((questionIndex: number, bounds: DiagramBounds): DiagramBounds => {
        const safeBounds = sanitizeBounds(bounds);
        const pageIndex = pageIndexMap.get(questionIndex);
        const naturalSize = pageIndex !== undefined ? naturalSizes.get(pageIndex) : undefined;
        const maxWidth = naturalSize?.width ?? Math.max(safeBounds.x + safeBounds.width, MIN_CROP_SIZE);
        const maxHeight = naturalSize?.height ?? Math.max(safeBounds.y + safeBounds.height, MIN_CROP_SIZE);
        let width = Math.max(MIN_CROP_SIZE, Math.min(safeBounds.width, maxWidth));
        let height = Math.max(MIN_CROP_SIZE, Math.min(safeBounds.height, maxHeight));
        let x = Math.max(0, Math.min(safeBounds.x, maxWidth - width));
        let y = Math.max(0, Math.min(safeBounds.y, maxHeight - height));
        return { x, y, width, height };
    }, [naturalSizes, pageIndexMap]);

    const registerImageSize = (pageIndex: number, width: number, height: number) => {
        setNaturalSizes(prev => {
            const next = new Map(prev);
            next.set(pageIndex, { width, height });
            return next;
        });
    };

    const startDrag = (handle: DragHandle, event: React.MouseEvent) => {
        if (!activeItem || !activeBounds || !naturalSizes.get(activeItem.info.pageIndex)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragState({
            handle,
            startX: event.clientX,
            startY: event.clientY,
            scale: zoom,
            questionIndex: activeItem.questionIndex,
            initialBounds: { ...activeBounds }
        });
    };

    useEffect(() => {
        if (!dragState) return;
        const handleMove = (event: MouseEvent) => {
            event.preventDefault();
            const deltaX = (event.clientX - dragState.startX) / dragState.scale;
            const deltaY = (event.clientY - dragState.startY) / dragState.scale;
            const tentative = applyHandleDelta(dragState.initialBounds, dragState.handle, deltaX, deltaY);
            const clamped = clampBoundsToPage(dragState.questionIndex, tentative);
            setBoundsByQuestion(prev => {
                const next = new Map(prev);
                next.set(dragState.questionIndex, clamped);
                return next;
            });
        };
        const handleUp = () => setDragState(null);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [clampBoundsToPage, dragState]);

    const handleZoomChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setZoom(parseFloat(event.target.value));
    };

    const handleResetBounds = () => {
        if (!activeItem) return;
        setBoundsByQuestion(prev => {
            const next = new Map(prev);
            next.set(activeItem.questionIndex, sanitizeBounds(activeItem.info.bounds));
            return next;
        });
    };

    const handleApplyReview = () => {
        const updated = diagramAssignments.map(([idx, info]) => {
            const override = boundsByQuestion.get(idx);
            return [idx, { ...info, bounds: sanitizeBounds(override ?? info.bounds) }] as [number, typeof info];
        });
        onApply(updated);
    };

    const snippet = activeItem ? activeItem.question.questionText.replace(/\s+/g, ' ').slice(0, 200) : '';
    const zoomPercent = Math.round(zoom * 100);
    const readyForEditing = Boolean(activePreview && naturalSizes.get(activeItem?.info.pageIndex ?? -1));

    if (!activeItem || !activeBounds) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-lg text-center space-y-4">
                    <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                        검수할 도면이 없습니다.
                    </p>
                    <button
                        onClick={onClose}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
                    >
                        닫기
                    </button>
                </div>
            </div>
        );
    }

    const activeNaturalSize = naturalSizes.get(activeItem.info.pageIndex);
    const naturalWidth = activeNaturalSize?.width ?? 1;
    const naturalHeight = activeNaturalSize?.height ?? 1;
    const displayWidth = naturalWidth * zoom;
    const displayHeight = naturalHeight * zoom;

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4 py-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
                <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
                            Step 2 · 사용자 검수
                        </p>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">
                            {subjectName} · 도면 크롭 검수 ({activeIndex + 1}/{reviewItems.length})
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            자동 캡처된 영역을 확인하고 4개의 핸들을 드래그하여 실제 경계에 맞춰 주세요.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
                    >
                        ✕
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                        <div className="space-y-5">
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                    문항 #{activeQuestionNumber}
                                </p>
                                <p className="text-base text-slate-900 dark:text-slate-50 line-clamp-3">
                                    {snippet || '문항 설명을 불러오는 중입니다.'}
                                </p>
                                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                    <p>페이지: {activeItem.info.pageIndex + 1}</p>
                                    <p>
                                        현재 좌표 (x: {Math.round(activeBounds.x)}, y: {Math.round(activeBounds.y)}) · 크기 ({Math.round(activeBounds.width)} × {Math.round(activeBounds.height)} px)
                                    </p>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">검수 목록</p>
                                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                                    {reviewItems.map((item, idx) => (
                                        <button
                                            key={item.questionIndex}
                                            onClick={() => setActiveIndex(idx)}
                                            className={`w-full text-left px-4 py-3 text-sm flex flex-col gap-1 transition-colors ${idx === activeIndex
                                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-100'
                                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                                                }`}
                                        >
                                            <span className="font-semibold">
                                                문항 #{item.questionIndex + 1}
                                            </span>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                페이지 {item.info.pageIndex + 1} · {Math.round(item.info.bounds.width)}×{Math.round(item.info.bounds.height)} px
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                        확대/축소
                                    </label>
                                    <span className="text-sm text-slate-500 dark:text-slate-400">{zoomPercent}%</span>
                                </div>
                                <input
                                    type="range"
                                    min={0.6}
                                    max={2.2}
                                    step={0.1}
                                    value={zoom}
                                    onChange={handleZoomChange}
                                    className="w-full accent-blue-600"
                                />
                                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span>넓게 보기</span>
                                    <span>픽셀 단위 미세 조정</span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setZoom(1)}
                                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    >
                                        100% 보기
                                    </button>
                                    <button
                                        onClick={handleResetBounds}
                                        className="flex-1 px-3 py-2 rounded-lg border border-amber-300 text-sm text-amber-600 hover:bg-amber-50"
                                    >
                                        자동 감지로 초기화
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center min-h-[420px]">
                            {previewSrc ? (
                                <div className="relative border border-slate-200 dark:border-slate-700 rounded-lg shadow-inner overflow-hidden" style={{ width: displayWidth, height: displayHeight }}>
                                    <img
                                        src={previewSrc}
                                        alt="문항 원본"
                                        draggable={false}
                                        style={{ width: displayWidth, height: displayHeight }}
                                        onLoad={(event) => registerImageSize(activeItem.info.pageIndex, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                                    />
                                    {readyForEditing && (
                                        <div
                                            className="absolute border-2 border-amber-400 bg-amber-200/20 cursor-move"
                                            style={{
                                                left: activeBounds.x * zoom,
                                                top: activeBounds.y * zoom,
                                                width: Math.max(activeBounds.width * zoom, MIN_CROP_SIZE),
                                                height: Math.max(activeBounds.height * zoom, MIN_CROP_SIZE)
                                            }}
                                            onMouseDown={(event) => startDrag('move', event)}
                                        >
                                            {handleOrder.map(handle => (
                                                <span
                                                    key={handle}
                                                    className="absolute w-3 h-3 bg-white border border-amber-500 rounded-sm"
                                                    style={{
                                                        cursor: `${handle}-resize`,
                                                        left: handle.endsWith('w') ? -6 : undefined,
                                                        right: handle.endsWith('e') ? -6 : undefined,
                                                        top: handle.startsWith('n') ? -6 : undefined,
                                                        bottom: handle.startsWith('s') ? -6 : undefined
                                                    }}
                                                    onMouseDown={(event) => startDrag(handle, event)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {!readyForEditing && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-slate-600">
                                            원본 이미지를 불러오는 중...
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center text-slate-500 dark:text-slate-300 text-sm">
                                    이 페이지의 미리보기를 찾을 수 없습니다.<br />
                                    AI가 감지한 좌표만 사용됩니다.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between bg-slate-50 dark:bg-slate-900/70">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        - 드래그로 위치 이동 · 코너 핸들로 크기를 조절하세요.<br />
                        - 모든 도면을 검수 후 "도면 검수 확정"을 눌러 주세요.
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
                                disabled={activeIndex === 0}
                                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-50"
                            >
                                이전
                            </button>
                            <button
                                onClick={() => setActiveIndex(Math.min(reviewItems.length - 1, activeIndex + 1))}
                                disabled={activeIndex === reviewItems.length - 1}
                                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-50"
                            >
                                다음
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300"
                            >
                                닫기
                            </button>
                            <button
                                onClick={handleApplyReview}
                                className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-lg"
                            >
                                도면 검수 확정
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default DiagramReviewModal;
