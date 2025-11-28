// components/QuizScreen.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
// NOTE: 실제 프로젝트의 타입 정의에 맞게 QuestionModel, AuthSession 등을 조정해야 합니다.
import { QuestionModel, AuthSession, GeneratedVariantProblem } from '../types';
import { quizApi } from '../services/quizApi';
import { generateAIExplanation, generateFiveVariants } from '../services/geminiService';
import FormattedText from './FormattedText'; // FormattedText 컴포넌트 임포트

interface QuizScreenProps {
  questions: QuestionModel[];
  onFinish: () => void;
  title: string;
  session: AuthSession;
  onStartVariantQuiz?: (questions: QuestionModel[]) => void;
  initialSolvedRecords?: Record<number, import('../types').UserQuizRecord>;
  examDuration?: number; // Duration in minutes for timed exams (e.g., 150 for mock test)
}

const QuizScreen: React.FC<QuizScreenProps> = ({ questions, onFinish, title, session, onStartVariantQuiz, initialSolvedRecords, examDuration }) => {
  // ----------------------------------------------------
  // 1. 상태 관리
  // ----------------------------------------------------
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [isAnswerChecked, setIsAnswerChecked] = useState(false); // 정답 확인 버튼을 눌렀는지 여부
  const [sessionAnswers, setSessionAnswers] = useState<{ [key: number]: number }>({}); // 세션 내 사용자 응답 기록

  // AI/힌트 관련 상태
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isFetchingExplanation, setIsFetchingExplanation] = useState(false);
  const [isGeneratingVariant, setIsGeneratingVariant] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  // Timer state (only for timed exams like mock tests)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(
    examDuration ? examDuration * 60 : null // Convert minutes to seconds
  );


  // ----------------------------------------------------
  // 2. Lifecycle & Data 초기화
  // ----------------------------------------------------
  useEffect(() => {
    // 퀴즈 목록이 변경되면 인덱스 초기화 및 이전 기록 로드
    const newSessionAnswers: { [key: number]: number } = {};
    let firstUnsolvedIndex = -1;

    questions.forEach((q, index) => {
      if (initialSolvedRecords && initialSolvedRecords[q.id]) {
        newSessionAnswers[index] = initialSolvedRecords[q.id].userAnswerIndex;
      } else if (firstUnsolvedIndex === -1) {
        firstUnsolvedIndex = index;
      }
    });

    setSessionAnswers(newSessionAnswers);
    // If all solved, start at 0. If some solved, start at first unsolved.
    setCurrentQuestionIndex(firstUnsolvedIndex === -1 ? 0 : firstUnsolvedIndex);
  }, [questions, initialSolvedRecords]);

  useEffect(() => {
    // 문제 인덱스가 변경될 때 상태 재설정
    const previouslyAnswered = sessionAnswers[currentQuestionIndex];
    if (previouslyAnswered !== undefined) {
      setSelectedAnswer(previouslyAnswered);
      setIsAnswerChecked(true); // 이전에 풀었던 문제라면 정답 확인 상태로 바로 전환
    } else {
      setSelectedAnswer(null);
      setIsAnswerChecked(false);
    }
    // AI 및 힌트 상태 초기화
    setAiExplanation(null);
    setIsFetchingExplanation(false);
    setIsGeneratingVariant(false);
    setVariantError(null);
    setShowHint(false);
  }, [currentQuestionIndex, sessionAnswers, questions]);

  // Timer countdown effect
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) {
      if (timeRemaining === 0) {
        // Time's up! Auto-finish the quiz
        onFinish();
      }
      return;
    }

    const interval = setInterval(() => {
      setTimeRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining, onFinish]);


  if (!questions || questions.length === 0) {
    return (
      <div className="text-center p-8">
        <h2 className="text-xl font-semibold">이번 세션에 사용할 수 있는 문제가 없습니다.</h2>
        <button onClick={onFinish} className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">
          학습 진행율로 돌아가기
        </button>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const correctAnswerIndex = currentQuestion.answerIndex;


  // ----------------------------------------------------
  // 3. 사용자 인터랙션 핸들러
  // ----------------------------------------------------

  const handleAnswerSelect = (index: number) => {
    if (isAnswerChecked) return; // 정답 확인 후에는 선택 불가
    setSelectedAnswer(index);
  };

  const handleCheckAnswer = () => {
    if (selectedAnswer === null || isAnswerChecked) return;

    setIsAnswerChecked(true);
    setSessionAnswers(prev => ({ ...prev, [currentQuestionIndex]: selectedAnswer }));

    // 정답 기록 저장
    quizApi.saveRecord({
      questionId: currentQuestion.id,
      userAnswerIndex: selectedAnswer,
      isCorrect: selectedAnswer === correctAnswerIndex,
    }, session.user.id);
  };

  const handleRelearn = () => {
    setIsAnswerChecked(false);
    setSelectedAnswer(null);
    setSessionAnswers(prev => {
      const newState = { ...prev };
      delete newState[currentQuestionIndex];
      return newState;
    });
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      onFinish(); // 마지막 문제라면 종료
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const handleShowExplanation = async () => {
    setIsFetchingExplanation(true);
    // AI 해설 생성
    const explanation = await generateAIExplanation(currentQuestion);
    setAiExplanation(explanation);
    setIsFetchingExplanation(false);
  };

  const handleGenerateVariant = async () => {
    setIsGeneratingVariant(true);
    setVariantError(null);
    try {
      // 1. Fetch exam standards for this question's certification and subject
      let examStandardsText: string | undefined;
      if (currentQuestion.certification) {
        const standards = await quizApi.getCertificationStandards(
          currentQuestion.certification,
          currentQuestion.subject
        );
        if (standards.length > 0 && standards[0].extractedText) {
          examStandardsText = standards[0].extractedText;
          console.log(`Using exam standards for ${currentQuestion.certification} - ${currentQuestion.subject}`);
        }
      }

      // 2. Check DB for existing variants
      let variants = await quizApi.getVariantsByParentId(currentQuestion.id);

      // 3. If no existing variants, generate new ones with exam standards
      if (!variants || variants.length === 0) {
        variants = await generateFiveVariants(currentQuestion, examStandardsText);

        // 4. Save generated variants to DB (caching)
        if (session) {
          await Promise.all(variants.map(v => quizApi.saveQuestion(v)));
        }
      }

      // 5. Start variant quiz
      if (onStartVariantQuiz) {
        onStartVariantQuiz(variants);
      } else {
        setVariantError('변형 문제 퀴즈 기능을 사용할 수 없습니다.');
      }
    } catch (error: any) {
      console.error(error);
      setVariantError(error.message || '유사 문제 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsGeneratingVariant(false);
    }
  };

  // ----------------------------------------------------
  // 4. UI/스타일 헬퍼
  // ----------------------------------------------------

  const getButtonClass = (index: number) => {
    // 정답 확인 전: 선택 상태 표시
    if (!isAnswerChecked) {
      if (index === selectedAnswer) {
        return "bg-blue-50 border-blue-500 ring-2 ring-blue-200";
      }
      return "bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-slate-600";
    }

    // 정답 확인 후: 정답(Green) / 오답(Red) / 나머지 표시
    if (index === correctAnswerIndex) {
      return "bg-green-100 dark:bg-green-900/30 border-green-500 text-green-800 dark:text-green-200";
    }
    if (index === selectedAnswer && index !== correctAnswerIndex) {
      return "bg-red-100 dark:bg-red-900/30 border-red-500 text-red-800 dark:text-red-200";
    }
    return "bg-slate-50 dark:bg-slate-800 opacity-60";
  };

  // Timer helper functions
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = (seconds: number): string => {
    const minutes = seconds / 60;
    if (minutes > 30) return 'text-green-600 dark:text-green-400';
    if (minutes > 10) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const isQuestionAnswered = useMemo(() => isAnswerChecked || sessionAnswers[currentQuestionIndex] !== undefined, [isAnswerChecked, currentQuestionIndex, sessionAnswers]);

  // ----------------------------------------------------
  // 5. 렌더링
  // ----------------------------------------------------
  const correctCount = Object.entries(sessionAnswers).filter(([idx, ans]) => questions[parseInt(idx)].answerIndex === ans).length;
  const wrongCount = Object.keys(sessionAnswers).length - correctCount;

  // ----------------------------------------------------
  // 5. 렌더링
  // ----------------------------------------------------
  return (
    <div className="flex flex-col max-w-3xl mx-auto w-full">
      {/* Top Header: Progress & Stats */}
      <div className="mb-8">
        <div className="flex gap-1 mb-2">
          {questions.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 flex-1 rounded-full transition-colors ${idx < currentQuestionIndex ? 'bg-yellow-400' :
                idx === currentQuestionIndex ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                }`}
            />
          ))}
        </div>

        {/* Timer Display (for timed exams) */}
        {timeRemaining !== null && (
          <div className="flex justify-center mb-3">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border-2 ${timeRemaining / 60 > 30 ? 'border-green-200 dark:border-green-800' :
              timeRemaining / 60 > 10 ? 'border-yellow-200 dark:border-yellow-800' :
                'border-red-200 dark:border-red-800'
              }`}>
              <svg className={`w-5 h-5 ${getTimerColor(timeRemaining)}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`text-xl font-bold font-mono ${getTimerColor(timeRemaining)}`}>
                {formatTime(timeRemaining)}
              </span>
            </div>
          </div>
        )}

        <div className="flex justify-end items-center gap-3 text-sm font-medium">
          <span className="text-slate-500 dark:text-slate-400">{currentQuestionIndex + 1} / {questions.length}</span>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs font-bold">
              ✕ {wrongCount}
            </span>
            <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded text-xs font-bold">
              ✓ {correctCount}
            </span>
          </div>
        </div>
      </div>

      {/* Question Area */}
      <div className="mb-8">
        <div className="flex items-start gap-2 text-lg md:text-xl text-slate-900 dark:text-slate-100 leading-relaxed font-medium">
          <span className="min-w-[24px]">{currentQuestionIndex + 1}.</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <FormattedText text={currentQuestion.questionText} />
              {initialSolvedRecords && initialSolvedRecords[currentQuestion.id] && (
                <span className="flex-shrink-0 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-xs font-bold rounded-full border border-blue-200 dark:border-blue-800">
                  학습 완료
                </span>
              )}
            </div>
            {currentQuestion.diagramUrl && (
              <div className="my-4">
                <img
                  src={currentQuestion.diagramUrl}
                  alt="문제 회로도"
                  className="max-w-full max-h-80 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Options Area */}
      <div className="space-y-3 mb-8">
        {currentQuestion.options.map((option, index) => {
          const isSelected = selectedAnswer === index;
          const isCorrect = index === correctAnswerIndex;

          let optionClass = "bg-slate-50 dark:bg-slate-800 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700";

          if (isAnswerChecked) {
            if (isCorrect) optionClass = "bg-green-50 dark:bg-green-900/20 border-green-200 text-green-800 dark:text-green-200";
            else if (isSelected && !isCorrect) optionClass = "bg-red-50 dark:bg-red-900/20 border-red-200 text-red-800 dark:text-red-200";
            else optionClass = "bg-slate-50 dark:bg-slate-800 opacity-50";
          } else if (isSelected) {
            optionClass = "bg-blue-50 dark:bg-blue-900/20 border-blue-200 ring-1 ring-blue-200";
          }

          return (
            <button
              key={index}
              onClick={() => handleAnswerSelect(index)}
              disabled={isAnswerChecked}
              className={`w-full text-left p-4 rounded-xl border transition-all duration-200 flex items-start group ${optionClass}`}
            >
              <span className={`font-medium mr-3 text-slate-500 dark:text-slate-400 ${isAnswerChecked && isCorrect ? 'text-green-600 font-bold' : ''}`}>
                {String.fromCharCode(65 + index)}.
              </span>
              <div className="flex-1 min-w-0">
                <FormattedText text={option} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Hint Section */}
      <div className="mb-8">
        <button
          onClick={() => setShowHint(!showHint)}
          className="text-slate-500 dark:text-slate-400 text-sm font-medium flex items-center hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          힌트 보기
          <svg className={`w-4 h-4 ml-1 transition-transform ${showHint ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showHint && (
          <div className="mt-3 p-4 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg text-slate-700 dark:text-slate-300 text-sm animate-fadeIn">
            <FormattedText text={currentQuestion.aiExplanation || currentQuestion.hint || "이 문제에는 힌트가 없습니다."} />
          </div>
        )}
      </div>

      {/* Explanation & AI Actions (Shown after answer) */}
      {
        isAnswerChecked && (
          <div className="mb-8 space-y-4 animate-fadeIn">
            <div className={`p-5 rounded-xl break-words overflow-wrap-anywhere ${selectedAnswer === correctAnswerIndex ? 'bg-green-50 dark:bg-green-900/10' : 'bg-red-50 dark:bg-red-900/10'}`}>
              <h3 className={`font-bold mb-2 ${selectedAnswer === correctAnswerIndex ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {selectedAnswer === correctAnswerIndex ? '정답입니다!' : '오답입니다.'}
              </h3>
              <div className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed break-words overflow-wrap-anywhere">
                정답은 <span className="font-bold">{correctAnswerIndex + 1}번</span>입니다.
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2">
              <button
                onClick={handleShowExplanation}
                disabled={isFetchingExplanation || !!aiExplanation}
                className="flex-shrink-0 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors disabled:opacity-50"
              >
                {isFetchingExplanation ? 'AI 해설 생성 중...' : 'AI 해설 보기'}
              </button>
              <button
                onClick={handleGenerateVariant}
                disabled={isGeneratingVariant}
                className="flex-shrink-0 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
              >
                {isGeneratingVariant ? '응용 문제 생성 중...' : '응용 문제 풀기'}
              </button>
              <button
                onClick={handleRelearn}
                className="flex-shrink-0 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors border border-slate-200 dark:border-slate-600"
              >
                재학습 하기
              </button>
            </div>

            {aiExplanation && (
              <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm break-words overflow-wrap-anywhere">
                <h4 className="font-bold mb-2 text-slate-700 dark:text-slate-200">AI 상세 해설</h4>
                <div className="text-slate-600 dark:text-slate-300 break-words overflow-wrap-anywhere">
                  <FormattedText text={aiExplanation} />
                </div>
              </div>
            )}
          </div>
        )
      }

      {/* Bottom Navigation */}
      <div className="mt-auto pt-6 flex justify-between items-center">
        <button
          onClick={handlePrevious}
          disabled={currentQuestionIndex === 0}
          className="text-slate-500 dark:text-slate-400 font-medium hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 transition-colors"
        >
          뒤로
        </button>

        {!isAnswerChecked ? (
          <button
            onClick={handleCheckAnswer}
            disabled={selectedAnswer === null}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-blue-200 dark:shadow-none disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:shadow-none transition-all transform active:scale-95"
          >
            정답 확인
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-blue-200 dark:shadow-none transition-all transform active:scale-95"
          >
            {currentQuestionIndex < questions.length - 1 ? '다음' : '결과 보기'}
          </button>
        )}
      </div>

      {variantError && <p className="mt-4 text-center text-sm text-red-500">{variantError}</p>}
    </div >
  );
};

export default QuizScreen;