
// This file is reserved for potential future hook extraction for Subject Selection,
// but for now, we will handle it via prose.
import React from 'react';
import { Certification, CERTIFICATION_SUBJECTS } from '../../constants';
import { MIN_EXAM_YEAR, MAX_EXAM_YEAR } from './utils';

interface SubjectSelectionSectionProps {
    certification: Certification;
    selectedSubject: string | null;
    setSelectedSubject: (subject: string | null) => void;
    yearInput: number | '';
    setYearInput: (val: string) => void;
    autoDetectedYear: number | null;
    yearError: string | null;
    shouldShowYearError: boolean;
    isYearTouched: boolean;
}

const SubjectSelectionSection: React.FC<SubjectSelectionSectionProps> = ({
    certification,
    selectedSubject,
    setSelectedSubject,
    yearInput,
    setYearInput,
    autoDetectedYear,
    yearError,
    shouldShowYearError,
    isYearTouched
}) => {
    return (
        <>
            <label className="block mb-4">
                <span className="text-slate-700 dark:text-slate-300 font-medium">2. 과목 선택 (선택 사항 - 정확도 향상)</span>
                <select
                    value={selectedSubject || ''}
                    onChange={(e) => setSelectedSubject(e.target.value || null)}
                    className="mt-1 block w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                >
                    <option value="">과목 자동 인식 (AI)</option>
                    {CERTIFICATION_SUBJECTS[certification]?.map((subject, idx) => (
                        <option key={idx} value={subject}>
                            {subject}
                        </option>
                    ))}
                </select>
            </label>

            <div className="mb-6">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                    2-1. 시험 연도 확인 (필수)
                </span>
                <div className="mt-2 space-y-2">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                        <input
                            type="number"
                            min={MIN_EXAM_YEAR}
                            max={MAX_EXAM_YEAR}
                            inputMode="numeric"
                            value={yearInput === '' ? '' : yearInput}
                            onChange={(e) => setYearInput(e.target.value)}
                            className="w-full md:w-48 px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                            placeholder={`${MIN_EXAM_YEAR}~${MAX_EXAM_YEAR}`}
                        />
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                            {autoDetectedYear && !isYearTouched
                                ? `파일 이름에서 ${autoDetectedYear}년을 감지했습니다. 필요하면 수정해 주세요.`
                                : '기출문제 추출 과정에서 연도 정보를 받지 못하면 직접 입력해 주세요.'
                            }
                        </div>
                    </div>
                    {shouldShowYearError ? (
                        <p className="text-xs text-red-500 dark:text-red-400">{yearError}</p>
                    ) : (
                        !autoDetectedYear && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                시험 연도를 확인하지 않으면 Supabase 저장을 실행할 수 없습니다.
                            </p>
                        )
                    )}
                </div>
            </div>
        </>
    );
};

export default SubjectSelectionSection;
