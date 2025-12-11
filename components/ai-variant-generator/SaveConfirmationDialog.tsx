import React from 'react';
import { SubjectProcessingPackage } from './utils';

interface SaveConfirmationDialogProps {
    completedSubjects: string[];
    pendingSubjects: string[];
    isBatchConfirmed: boolean;
    isSavingSubject: boolean;
    pendingSubjectPackage: SubjectProcessingPackage | null;
    isYearValid: boolean;
    requiresDiagramReview: boolean;
    isDiagramReviewComplete: boolean;
    onOpenDiagramReview: () => void;
    yearInput: number | '';
    onYearChange: (value: string) => void;
    yearError: string | null;
    shouldShowYearError: boolean;
    handleSaveCurrentSubject: () => void;
    onNext: () => void;
    onCancel: () => void;
}

const SaveConfirmationDialog: React.FC<SaveConfirmationDialogProps> = ({
    completedSubjects,
    pendingSubjects,
    isBatchConfirmed,
    isSavingSubject,
    pendingSubjectPackage,
    isYearValid,
    requiresDiagramReview,
    isDiagramReviewComplete,
    onOpenDiagramReview,
    yearInput,
    onYearChange,
    yearError,
    shouldShowYearError,
    handleSaveCurrentSubject,
    onNext,
    onCancel,
}) => {
    const lastCompletedSubject = completedSubjects[completedSubjects.length - 1] ?? '과목';
    const diagramCount = pendingSubjectPackage?.questionDiagramMap.length ?? 0;
    const isComplete = pendingSubjects.length === 0;
    const isSaveDisabled =
        isSavingSubject ||
        isBatchConfirmed ||
        !pendingSubjectPackage ||
        !isYearValid ||
        (requiresDiagramReview && !isDiagramReviewComplete);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-blue-200 dark:border-blue-800 p-6 space-y-6">
                <div className="text-center space-y-2">
                    <div className="text-5xl">🎉</div>
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                        {lastCompletedSubject} 저장 완료
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-300">
                        JSON 파일은 자동으로 다운로드되었습니다. Supabase 저장 단계를 계속 진행해 주세요.
                    </p>
                </div>

                {pendingSubjects.length > 0 && (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        <p className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-1">
                            남은 과목
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-200">
                            {pendingSubjects.join(', ')}
                        </p>
                    </div>
                )}

                {requiresDiagramReview && pendingSubjectPackage && (
                    <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 space-y-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                                    사용자 검수 필요 ({diagramCount}건)
                                </p>
                                <p className="text-xs text-blue-700 dark:text-blue-100">
                                    크롭 영역을 확정해야 Supabase 저장을 진행할 수 있습니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onOpenDiagramReview}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow"
                            >
                                도면 검수 열기
                            </button>
                        </div>
                        <p className={`text-xs ${isDiagramReviewComplete ? 'text-green-600 dark:text-green-300' : 'text-amber-600 dark:text-amber-300'}`}>
                            {isDiagramReviewComplete ? '검수 완료 · 조정 내용이 저장되었습니다.' : '검수 미완료 · 핸들을 조정해 정확한 경계를 지정한 뒤 확정해 주세요.'}
                        </p>
                    </div>
                )}

                {!isYearValid && (
                    <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold">시험 연도 입력 필요</p>
                                <p className="text-xs text-amber-700">
                                    Supabase 저장을 진행하려면 연도를 먼저 입력해야 합니다.
                                </p>
                            </div>
                            <input
                                type="number"
                                min={2000}
                                max={2100}
                                value={yearInput === '' ? '' : yearInput}
                                onChange={(e) => onYearChange(e.target.value)}
                                className="w-28 px-3 py-1.5 rounded-md border border-amber-300 bg-white text-sm text-amber-800"
                                placeholder="예: 2024"
                            />
                        </div>
                        {shouldShowYearError && yearError && (
                            <p className="text-xs text-red-600">{yearError}</p>
                        )}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
                            Supabase 저장
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={handleSaveCurrentSubject}
                                disabled={isSaveDisabled}
                                className={`px-4 py-3 rounded-xl font-semibold text-sm transition-colors shadow ${isSaveDisabled
                                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-700 dark:text-slate-400'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                                type="button"
                            >
                                {isBatchConfirmed ? '저장 완료' : isSavingSubject ? 'Supabase 저장 중...' : 'Supabase로 저장'}
                            </button>
                            {!isBatchConfirmed && !isSavingSubject && (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    저장이 완료되면 다음 과목으로 이동할 수 있습니다.
                                </p>
                            )}
                            {requiresDiagramReview && !isDiagramReviewComplete && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    도면 검수 단계가 완료되어야 저장 버튼이 활성화됩니다.
                                </p>
                            )}
                            {!isYearValid && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    시험 연도를 입력한 뒤 저장을 진행해 주세요.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={onNext}
                            disabled={!isBatchConfirmed}
                            className="flex-1 py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
                        >
                            {isComplete ? '닫기' : '다음 과목으로'}
                        </button>
                        <button
                            onClick={onCancel}
                            className="flex-1 py-3 rounded-xl font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100"
                        >
                            중단
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SaveConfirmationDialog;
