
import React from 'react';
import { SubjectProcessingPackage } from './utils';

interface SaveConfirmationDialogProps {
    completedSubjects: string[];
    pendingSubjects: string[];
    isBatchConfirmed: boolean;
    isSavingSubject: boolean;
    pendingSubjectPackage: SubjectProcessingPackage | null;
    isYearValid: boolean;
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
    handleSaveCurrentSubject,
    onNext,
    onCancel,
}) => {
    const lastCompletedSubject = completedSubjects[completedSubjects.length - 1];
    const isComplete = pendingSubjects.length === 0;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-2xl max-w-md w-full mx-4 border-2 border-blue-500">
                <div className="text-center mb-6">
                    <div className="text-5xl mb-4">✅</div>
                    <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                        {lastCompletedSubject} 완료!
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400">
                        JSON 파일이 다운로드되었습니다.
                    </p>
                </div>

                {pendingSubjects.length > 0 && (
                    <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            남은 과목:
                        </p>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                            {pendingSubjects.join(', ')}
                        </p>
                    </div>
                )}

                <div className="flex gap-3 flex-col">
                    <div className="mb-4 text-left">
                        <p className="text-slate-700 dark:text-slate-200 text-sm mb-2">
                            JSON 파일은 자동으로 저장/다운로드되었습니다.
                        </p>
                        <div className="p-4 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
                                Supabase Batch 저장을 진행해 주세요.
                            </p>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleSaveCurrentSubject}
                                    disabled={isSavingSubject || isBatchConfirmed || !pendingSubjectPackage || !isYearValid}
                                    className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${isBatchConfirmed
                                        ? 'bg-green-100 border-green-500 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700'
                                        }`}
                                    type="button"
                                >
                                    {isBatchConfirmed
                                        ? '저장 완료됨'
                                        : isSavingSubject
                                            ? 'Supabase 저장 중...'
                                            : 'Supabase에 저장'}
                                </button>
                                {!isBatchConfirmed && !isSavingSubject && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                        저장이 완료되면 자동으로 다음 과목을 진행할 수 있습니다.
                                    </span>
                                )}
                                {!isYearValid && (
                                    <span className="text-xs text-amber-600 dark:text-amber-400">
                                        시험 연도를 확인하지 않으면 Supabase 저장을 실행할 수 없습니다.
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={onNext}
                            disabled={!isBatchConfirmed}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105"
                        >
                            {isComplete ? '완료' : '다음 과목 진행'}
                        </button>
                        <button
                            onClick={onCancel}
                            className="flex-1 bg-slate-300 hover:bg-slate-400 text-slate-700 font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105"
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
