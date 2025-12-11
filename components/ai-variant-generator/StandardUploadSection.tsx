
import React from 'react';
import { useStandardUpload } from './useStandardUpload';

interface StandardUploadSectionProps {
    certification: string;
    selectedSubject: string | null;
}

const StandardUploadSection: React.FC<StandardUploadSectionProps> = ({
    certification,
    selectedSubject
}) => {
    const {
        standardFiles,
        isUploadingStandard,
        handleStandardFileChange,
        removeStandardFile,
        handleUploadStandard
    } = useStandardUpload({ certification, selectedSubject });

    return (
        <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
            <span className="text-slate-700 dark:text-slate-300 font-medium mb-2 block">
                1. 출제 기준 업로드 (선택 사항 - 해당 과목의 출제 기준 PDF/이미지)
            </span>
            <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="file"
                        accept="application/pdf,image/*"
                        multiple
                        onChange={handleStandardFileChange}
                        className="block w-full text-sm text-slate-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
            "
                    />
                    <button
                        onClick={handleUploadStandard}
                        disabled={standardFiles.length === 0 || !selectedSubject || isUploadingStandard}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                        {isUploadingStandard ? '저장 중...' : '출제 기준 저장'}
                    </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    * PDF 또는 이미지(JPG, PNG 등)를 여러 개 선택하여 업로드해주세요.
                </p>

                {standardFiles.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {standardFiles.map((file, index) => (
                            <div
                                key={`${file.name}-${index}`}
                                className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-600"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {file.name}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type === 'application/pdf' ? 'PDF' : '이미지'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeStandardFile(index)}
                                    className="ml-2 p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 rounded"
                                    title="삭제"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {!selectedSubject && (
                <p className="text-xs text-red-500 mt-1">
                    * 출제 기준을 업로드하려면 2번 메뉴에서 먼저 과목을 선택해야 합니다.
                </p>
            )}
        </div>
    );
};

export default StandardUploadSection;
