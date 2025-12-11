import React from 'react';
import { SubjectRangeConfig } from './useAiProcessing';

interface SubjectRangesSectionProps {
    selectedSubject: string | null;
    subjectRanges: SubjectRangeConfig[];
    onFieldChange: (index: number, field: keyof Omit<SubjectRangeConfig, 'id'>, value: string) => void;
    onAddRange: () => void;
    onRemoveRange: (index: number) => void;
    onResetRanges: () => void;
}

const SubjectRangesSection: React.FC<SubjectRangesSectionProps> = ({
    selectedSubject,
    subjectRanges,
    onFieldChange,
    onAddRange,
    onRemoveRange,
    onResetRanges
}) => {
    const isDisabled = Boolean(selectedSubject);

    return (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <span className="block text-slate-700 dark:text-slate-200 font-semibold">
                        3. 과목별 페이지 / 문항 범위
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        PDF 전체를 업로드할 때 과목의 시작·종료 페이지와 문항 번호를 지정하세요.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onResetRanges}
                        disabled={isDisabled}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-600 dark:text-slate-300 disabled:opacity-50"
                    >
                        기본값 복원
                    </button>
                    <button
                        type="button"
                        onClick={onAddRange}
                        disabled={isDisabled}
                        className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-600 text-xs font-medium hover:bg-blue-50 disabled:opacity-50"
                    >
                        범위 추가
                    </button>
                </div>
            </div>

            {isDisabled && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs p-3">
                    개별 과목을 직접 선택한 상태에서는 페이지 범위가 사용되지 않습니다. 자동 과목 구분을 사용하려면 "과목 자동 감지" 옵션을 선택하세요.
                </div>
            )}

            <div className="space-y-3">
                {subjectRanges.map((range, index) => (
                    <div
                        key={range.id}
                        className={`p-4 rounded-xl border ${isDisabled ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 opacity-70' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400">과목명</label>
                                <input
                                    type="text"
                                    value={range.name}
                                    onChange={(e) => onFieldChange(index, 'name', e.target.value)}
                                    disabled={isDisabled}
                                    className="w-64 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm dark:bg-slate-900 dark:text-white disabled:bg-slate-50 dark:disabled:bg-slate-900"
                                    placeholder="예) 회로이론"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemoveRange(index)}
                                disabled={isDisabled || subjectRanges.length <= 1}
                                className="text-sm text-red-500 hover:text-red-600 disabled:opacity-40"
                            >
                                삭제
                            </button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">시작 페이지</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={range.startPage}
                                    onChange={(e) => onFieldChange(index, 'startPage', e.target.value)}
                                    disabled={isDisabled}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">종료 페이지</label>
                                <input
                                    type="number"
                                    min={range.startPage}
                                    value={range.endPage}
                                    onChange={(e) => onFieldChange(index, 'endPage', e.target.value)}
                                    disabled={isDisabled}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">문항 시작</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={range.questionStart}
                                    onChange={(e) => onFieldChange(index, 'questionStart', e.target.value)}
                                    disabled={isDisabled}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">문항 종료</label>
                                <input
                                    type="number"
                                    min={range.questionStart}
                                    value={range.questionEnd}
                                    onChange={(e) => onFieldChange(index, 'questionEnd', e.target.value)}
                                    disabled={isDisabled}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SubjectRangesSection;
