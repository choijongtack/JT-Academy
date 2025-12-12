
import React, { ChangeEvent } from 'react';
import { Screen, AuthSession } from '../types';
import { Certification } from '../constants';
import { isAdmin } from '../services/authService';

// Hooks
import { useAiProcessing } from './ai-variant-generator/useAiProcessing';

// Components
import StandardUploadSection from './ai-variant-generator/StandardUploadSection';
import SubjectSelectionSection from './ai-variant-generator/SubjectSelectionSection';
import SaveConfirmationDialog from './ai-variant-generator/SaveConfirmationDialog';
import DiagramReviewModal from './ai-variant-generator/DiagramReviewModal';
import SubjectRangesSection from './ai-variant-generator/SubjectRangesSection';

interface AiVariantGeneratorScreenProps {
    navigate: (screen: Screen) => void;
    session: AuthSession;
    certification: Certification;
    onQuestionsUpdated?: () => void;
}

const AiVariantGeneratorScreen: React.FC<AiVariantGeneratorScreenProps> = ({ navigate, session, certification, onQuestionsUpdated }) => {

    const [selectedSubject, setSelectedSubject] = React.useState<string | null>(null);

    // State & Logic from Hook
    const {
        // File State
        selectedFiles,
        isDragging,
        handleFilesAdded,
        handleRemoveFile,
        handleClearAll,

        // Year State
        yearInput,
        setYearInput,
        autoDetectedYear,
        yearError,
        shouldShowYearError,
        isYearTouched,

        // Subject & Ranges
        currentSubject,
        completedSubjects,
        pendingSubjects,
        isPaused,
        setIsPaused,
        isBatchConfirmed,
        isSavingSubject,
        pendingSubjectPackage,
        isDiagramReviewOpen,
        isDiagramReviewComplete,
        openDiagramReview,
        closeDiagramReview,
        applyDiagramReview,
        subjectRanges,
        handleSubjectRangeFieldChange,
        handleAddSubjectRange,
        handleRemoveSubjectRange,
        handleResetSubjectRanges,

        // Processing
        isProcessing,
        statusMessage,
        error,
        handleProcessStart,
        handleSaveCurrentSubject,
        extractedQuestions,
        generatedVariants,
        previewImages
    } = useAiProcessing({
        certification,
        selectedSubject,
        session
    });
    const requiresDiagramReview = Boolean(pendingSubjectPackage?.questionDiagramMap.length);

    // Helpers for Drag & Drop
    const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        const files = Array.from(e.dataTransfer.files) as File[];
        handleFilesAdded(files);
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []) as File[];
        handleFilesAdded(files);
        e.target.value = '';
    };

    if (!isAdmin(session)) {
        return <div className="p-8 text-center">관리자 권한이 필요합니다.</div>;
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center border-b pb-4">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
                    AI 문제 생성기 (PDF/이미지)
                </h2>
                <div className="flex gap-2">
                    <button onClick={() => navigate('dashboard')} className="text-blue-500 hover:underline">
                        나가기
                    </button>
                </div>
            </div>

            {/* Status Panel */}
            {currentSubject && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-blue-800 dark:text-blue-300">
                            🔄 현재 처리 중: {currentSubject}
                        </h3>
                        <span className="text-sm text-blue-600 dark:text-blue-400">
                            {completedSubjects.length} / {subjectRanges.length} 과목 완료
                        </span>
                    </div>
                    {statusMessage && <p className="text-sm text-slate-600 dark:text-slate-400">{statusMessage}</p>}
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/30 p-4 rounded-lg border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Save Confirmation Dialog */}
            {isPaused && (!requiresDiagramReview || isDiagramReviewComplete) && (
                <SaveConfirmationDialog
                    completedSubjects={completedSubjects}
                    pendingSubjects={pendingSubjects}
                    isBatchConfirmed={isBatchConfirmed}
                    isSavingSubject={isSavingSubject}
                    pendingSubjectPackage={pendingSubjectPackage}
                    isYearValid={!shouldShowYearError}
                    requiresDiagramReview={requiresDiagramReview}
                    isDiagramReviewComplete={isDiagramReviewComplete}
                    onOpenDiagramReview={openDiagramReview}
                    yearInput={yearInput}
                    onYearChange={(val) => setYearInput(val)}
                    yearError={yearError}
                    shouldShowYearError={shouldShowYearError}
                    handleSaveCurrentSubject={handleSaveCurrentSubject}
                    onNext={() => {
                        setIsPaused(false);
                        if (!selectedSubject) {
                            handleResetSubjectRanges();
                        }
                    }}
                    onCancel={() => {
                        setIsPaused(false);
                        if (!selectedSubject) {
                            handleResetSubjectRanges();
                        }
                        // Trigger cancel logic via hook if exposed, or just reset
                    }}
                />
            )}
            {isPaused && requiresDiagramReview && !isDiagramReviewComplete && (
                <div className="fixed inset-0 flex items-center justify-center z-40 pointer-events-none">
                    <div className="bg-white/90 dark:bg-slate-900/90 px-6 py-3 rounded-full text-sm font-semibold text-blue-700 dark:text-blue-200 shadow-lg border border-blue-200 dark:border-blue-800">
                        도면 검수 완료 후 저장 단계를 진행할 수 있습니다.
                    </div>
                </div>
            )}

            {pendingSubjectPackage && requiresDiagramReview && isDiagramReviewOpen && (
                <DiagramReviewModal
                    subjectName={pendingSubjectPackage.subjectName}
                    questions={pendingSubjectPackage.questions}
                    diagramAssignments={pendingSubjectPackage.questionDiagramMap}
                    pagePreviews={pendingSubjectPackage.previewImages}
                    selectedSubject={selectedSubject}
                    onClose={closeDiagramReview}
                    onApply={applyDiagramReview}
                />
            )}

            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                {/* 1. Standard Upload */}
                <StandardUploadSection
                    certification={certification}
                    selectedSubject={selectedSubject}
                />

                {/* 2. Subject & Year Selection */}
                <SubjectSelectionSection
                    certification={certification}
                    selectedSubject={selectedSubject}
                    setSelectedSubject={setSelectedSubject}
                    yearInput={yearInput}
                    setYearInput={(val) => setYearInput(val)} // Adapter
                    autoDetectedYear={autoDetectedYear}
                    yearError={yearError}
                    shouldShowYearError={shouldShowYearError}
                    isYearTouched={isYearTouched}
                />
                <SubjectRangesSection
                    selectedSubject={selectedSubject}
                    subjectRanges={subjectRanges}
                    onFieldChange={handleSubjectRangeFieldChange}
                    onAddRange={handleAddSubjectRange}
                    onRemoveRange={handleRemoveSubjectRange}
                    onResetRanges={handleResetSubjectRanges}
                />

                {/* 3. Question File Upload */}
                <div
                    className={`mt-8 border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                >
                    <div className="space-y-4">
                        <div className="text-4xl">📄</div>
                        <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                            기출문제 파일 업로드
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                            PDF 또는 이미지(JPG, PNG) 파일을 드래그하여 놓거나 선택하세요.<br />
                            (최대 10개, 파일당 10MB)
                        </p>

                        <input
                            type="file"
                            multiple
                            accept=".pdf,image/*"
                            onChange={handleFileChange}
                            className="hidden"
                            id="question-file-upload"
                        />
                        <label
                            htmlFor="question-file-upload"
                            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer transition-colors"
                        >
                            파일 선택
                        </label>
                    </div>

                    {selectedFiles.length > 0 && (
                        <div className="mt-6 space-y-2 text-left">
                            {selectedFiles.map((file, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700 rounded-lg">
                                    <span className="text-sm truncate max-w-xs dark:text-slate-200">{file.name}</span>
                                    <button
                                        onClick={() => handleRemoveFile(idx)}
                                        className="text-red-500 hover:text-red-700"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                            <button
                                onClick={handleClearAll}
                                className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 underline mt-2"
                            >
                                전체 삭제
                            </button>
                        </div>
                    )}
                </div>

                {/* 4. Action Button */}
                <div className="mt-8">
                    <button
                        onClick={handleProcessStart}
                        disabled={isProcessing || selectedFiles.length === 0}
                        className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-[0.99] text-lg"
                    >
                        {isProcessing ? 'AI 분석 및 문제 추출 중...' : '문제 추출 시작'}
                    </button>
                </div>

                {/* 5. Preview of Recognized Pages */}
                {previewImages.length > 0 && (
                    <div className="mt-10">
                        <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-3">
                            인식된 페이지 미리보기 ({previewImages.length}장)
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-80 overflow-y-auto pr-1">
                            {previewImages.map((src, idx) => (
                                <div
                                    key={idx}
                                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
                                >
                                    <img
                                        src={src}
                                        alt={`업로드 페이지 ${idx + 1}`}
                                        className="w-full h-32 object-cover rounded-t-lg"
                                    />
                                    <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                                        페이지 {idx + 1}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 6. Extracted Questions */}
                {extractedQuestions.length > 0 && (
                    <div className="mt-10">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                                추출된 문제 ({extractedQuestions.length}문제)
                            </h4>
                            <span className="text-xs text-slate-400">
                                JSON 저장 및 Supabase 업로드 전에 내용을 검토하세요.
                            </span>
                        </div>
                        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {extractedQuestions.map((question, idx) => (
                                <div
                                    key={`${question.questionText}-${idx}`}
                                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                                >
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                        문항 #{idx + 1} {question.subject ? `· ${question.subject}` : ''}
                                    </p>
                                    <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-line">
                                        {question.questionText}
                                    </p>
                                    {question.options?.length > 0 && (
                                        <ul className="mt-2 space-y-1 text-sm">
                                            {question.options.map((option, optionIdx) => {
                                                const isCorrect = optionIdx === question.answerIndex;
                                                return (
                                                    <li
                                                        key={`${idx}-option-${optionIdx}`}
                                                        className={`px-3 py-1.5 rounded-lg border text-slate-700 dark:text-slate-100 ${isCorrect
                                                            ? 'border-green-400 bg-green-50 dark:bg-green-900/30'
                                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                                                            }`}
                                                    >
                                                        <span className="font-semibold mr-2">{optionIdx + 1}.</span>
                                                        <span>{option}</span>
                                                        {isCorrect && (
                                                            <span className="ml-2 text-xs font-semibold text-green-600 dark:text-green-300">
                                                                (정답)
                                                            </span>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default AiVariantGeneratorScreen;
