import React, { useState, useEffect, useCallback } from 'react';
import { Screen, WrongAnswerModel, QuestionModel, AuthSession } from '../types';
import { quizApi } from '../services/quizApi';
import { generateFiveVariants } from '../services/geminiService';
import FormattedText from './FormattedText';

interface WrongNoteScreenProps {
  navigate: (screen: Screen) => void;
  startReview: (questionId: number) => void;
  session: AuthSession;
  onStartVariantQuiz?: (questions: QuestionModel[]) => void;
}

interface WrongAnswerDetail extends WrongAnswerModel {
  question: QuestionModel;
}

const WrongNoteScreen: React.FC<WrongNoteScreenProps> = ({ navigate, startReview, session, onStartVariantQuiz }) => {
  const [wrongAnswers, setWrongAnswers] = useState<WrongAnswerDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generatingVariantFor, setGeneratingVariantFor] = useState<number | null>(null);

  const fetchWrongAnswers = useCallback(async () => {
    setIsLoading(true);
    const wrongAnswerModels = await quizApi.getWrongAnswers(session.user.id);
    const detailedAnswers: WrongAnswerDetail[] = [];

    for (const wa of wrongAnswerModels) {
      const question = await quizApi.getQuestionById(wa.questionId);
      if (question) {
        detailedAnswers.push({ ...wa, question });
      }
    }

    setWrongAnswers(detailedAnswers);
    setIsLoading(false);
  }, [session]);

  useEffect(() => {
    fetchWrongAnswers();
  }, [fetchWrongAnswers]);

  const handleGenerateVariants = async (question: QuestionModel) => {
    setGeneratingVariantFor(question.id);
    try {
      // 1. Fetch exam standards if available
      let examStandardsText: string | undefined;
      if (question.certification) {
        const standards = await quizApi.getCertificationStandards(
          question.certification,
          question.subject
        );
        if (standards.length > 0 && standards[0].extractedText) {
          examStandardsText = standards[0].extractedText;
        }
      }

      // 2. Check for existing variants
      let variants = await quizApi.getVariantsByParentId(question.id);

      // 3. Generate new variants if none exist
      if (!variants || variants.length === 0) {
        variants = await generateFiveVariants(question, examStandardsText);

        // Save to DB
        await Promise.all(variants.map(v => quizApi.saveQuestion(v)));
      }

      // 4. Start variant quiz
      if (onStartVariantQuiz) {
        onStartVariantQuiz(variants);
      }
    } catch (error) {
      console.error('Error generating variants:', error);
      alert('응용 문제 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingVariantFor(null);
    }
  };

  if (isLoading) {
    return <div className="text-center p-8">오답 노트를 불러오는 중...</div>;
  }

  if (wrongAnswers.length === 0) {
    return (
      <div className="text-center p-8">
        <h2 className="text-xl font-semibold">오답이 아직 없습니다.</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2">계속 연습하세요!</p>
        <button
          onClick={() => navigate('dashboard')}
          className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg"
        >
          학습 진행율로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">오답 노트</h2>
        <button
          onClick={() => navigate('dashboard')}
          className="text-blue-500 hover:underline"
        >
          학습 진행율로 돌아가기
        </button>
      </div>
      <div className="space-y-4">
        {wrongAnswers.map((item) => (
          <div
            key={item.recordId}
            className="bg-slate-100 dark:bg-slate-700 p-4 rounded-lg"
          >
            <div className="flex-grow mb-3">
              <p className="font-semibold text-slate-800 dark:text-slate-200"><FormattedText text={item.question.questionText} /></p>
              <div className="flex items-center text-sm text-slate-500 dark:text-slate-400 mt-1">
                <span>{item.question.subject}</span>
                <span className="mx-2">|</span>
                <span>{item.wrongCount}번 틀림</span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => startReview(item.questionId)}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors flex-shrink-0"
              >
                복습하기
              </button>
              <button
                onClick={() => handleGenerateVariants(item.question)}
                disabled={generatingVariantFor === item.questionId}
                className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generatingVariantFor === item.questionId ? '생성 중...' : '응용 문제 풀기'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WrongNoteScreen;