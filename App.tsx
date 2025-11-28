import React, { useState, useCallback, useEffect } from 'react';
import { Screen, QuestionModel, AuthSession } from './types';
import DashboardScreen from './components/DashboardScreen';
import QuizScreen from './components/QuizScreen';
import WrongNoteScreen from './components/WrongNoteScreen';
import SubjectSelectionScreen from './components/SubjectSelectionScreen';
import AiVariantGeneratorScreen from './components/AiVariantGeneratorScreen';
import AuthScreen from './components/AuthScreen';
import { quizApi } from './services/quizApi';
import { supabase } from './services/supabaseClient';
import { isAdmin } from './services/authService';
import { useMediaQuery } from './hooks/useMediaQuery';
import { Certification, CERTIFICATIONS } from './constants';


const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [currentScreen, setCurrentScreen] = useState<Screen>('dashboard');
  const [quizQuestions, setQuizQuestions] = useState<QuestionModel[]>([]);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizReturnScreen, setQuizReturnScreen] = useState<Screen>('dashboard');
  const [selectedCertification, setSelectedCertification] = useState<Certification>('전기기사');

  const [initialSolvedRecords, setInitialSolvedRecords] = useState<Record<number, import('./types').UserQuizRecord>>({});
  const [isMockTest, setIsMockTest] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const containerClasses = isMobile
    ? 'min-h-screen w-full px-4 py-4 flex flex-col items-center bg-slate-50 dark:bg-slate-900'
    : 'min-h-screen container mx-auto p-4 md:p-8 flex flex-col items-center bg-slate-50 dark:bg-slate-900';

  const headerWrapperClasses = isMobile ? 'w-full mb-6' : 'w-full max-w-4xl mb-8';
  // Reduced font size as requested (approx 2/3 of original)
  const headingClasses = `font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-teal-400 ${isMobile ? 'text-2xl' : 'text-3xl md:text-4xl'
    }`;

  const cardClasses = `w-full max-w-4xl bg-white dark:bg-slate-800 rounded-2xl shadow-xl ${isMobile ? 'p-4' : 'p-6 md:p-8'
    }`;
  const footerClasses = isMobile ? 'mt-6 text-center text-slate-500 text-xs' : 'mt-8 text-center text-slate-500 text-sm';

  // Load certification from localStorage on mount
  useEffect(() => {
    const savedCertification = localStorage.getItem('selectedCertification') as Certification;
    if (savedCertification && CERTIFICATIONS.includes(savedCertification)) {
      setSelectedCertification(savedCertification);
    }
  }, []);

  // Save certification to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('selectedCertification', selectedCertification);
  }, [selectedCertification]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsCheckingSession(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (_event === 'SIGNED_OUT') {
        setCurrentScreen('dashboard');
        setQuizQuestions([]);
        setQuizTitle('');
        setInitialSolvedRecords({});
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const navigate = (screen: Screen) => {
    setCurrentScreen(screen);
  };

  const startMockTest = useCallback(async () => {
    if (!session) return;
    setQuizTitle("모의고사");
    setIsMockTest(true);
    const questions = await quizApi.generateMockTest(100, selectedCertification);
    setQuizQuestions(questions);
    setInitialSolvedRecords({});
    setQuizReturnScreen('dashboard');
    setCurrentScreen('quiz');
  }, [session, selectedCertification]);

  const startWrongAnswerReview = useCallback(async (questionId: number) => {
    if (!session) return;
    setQuizTitle("오답노트 복습");
    const wrongAnswers = await quizApi.getWrongAnswers(session.user.id);
    const wrongQuestionIds = wrongAnswers.map(wa => wa.questionId);

    const specificQuestion = await quizApi.getQuestionById(questionId);

    const otherWrongQuestions = await Promise.all(
      wrongQuestionIds
        .filter(id => id !== questionId)
        .map(id => quizApi.getQuestionById(id))
    );

    const questions = [
      specificQuestion,
      ...otherWrongQuestions
    ].filter((q): q is QuestionModel => q !== undefined);

    if (questions.length > 0) {
      setQuizQuestions(questions);
      setInitialSolvedRecords({});
      setQuizReturnScreen('wrong-note');
      setCurrentScreen('quiz');
    }
  }, [session]);

  const startSubjectQuiz = useCallback(async (subject: string, topic?: string) => {
    if (!session) return;
    setQuizTitle(topic ? `${subject} - ${topic}` : subject);
    setIsMockTest(false);

    // Load questions
    const questions = await quizApi.loadQuestions({ subject, topic, certification: selectedCertification });
    setQuizQuestions(questions);

    // Load user records for these questions to resume learning
    const allRecords = await quizApi.getAllRecords(session.user.id);
    const recordMap: Record<number, import('./types').UserQuizRecord> = {};

    // Filter records relevant to loaded questions
    const questionIds = new Set(questions.map(q => q.id));
    allRecords.forEach(record => {
      if (questionIds.has(record.questionId)) {
        recordMap[record.questionId] = record;
      }
    });

    setInitialSolvedRecords(recordMap);
    setQuizReturnScreen('subject-select');
    setCurrentScreen('quiz');
  }, [session, selectedCertification]);

  const handleStartVariantQuiz = useCallback((questions: QuestionModel[]) => {
    setQuizTitle("AI 응용 문제 풀기");
    setQuizQuestions(questions);
    setInitialSolvedRecords({});
    setQuizReturnScreen('dashboard');
    setCurrentScreen('quiz');
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const renderScreen = () => {
    if (!session) return null;

    switch (currentScreen) {
      case 'quiz':
        return <QuizScreen
          questions={quizQuestions}
          onFinish={() => navigate(quizReturnScreen)}
          title={quizTitle}
          session={session}
          onStartVariantQuiz={handleStartVariantQuiz}
          initialSolvedRecords={initialSolvedRecords}
          examDuration={isMockTest ? 150 : undefined}
        />;
      case 'wrong-note':
        return <WrongNoteScreen navigate={navigate} startReview={startWrongAnswerReview} session={session} onStartVariantQuiz={handleStartVariantQuiz} />;
      case 'subject-select':
        return <SubjectSelectionScreen navigate={navigate} onSelectSubject={startSubjectQuiz} certification={selectedCertification} />;
      case 'ai-variant-generator':
        return <AiVariantGeneratorScreen navigate={navigate} session={session} certification={selectedCertification} onQuestionsUpdated={() => {
        }} />;
      case 'dashboard':
      default:
        return <DashboardScreen navigate={navigate} startMockTest={startMockTest} session={session} certification={selectedCertification} />;
    }
  };

  if (isCheckingSession) {
    return (
      <div className={`${containerClasses} justify-center`}>
        <p>세션 확인 중...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={containerClasses}>
        <header className={headerWrapperClasses}>
          <div className="text-center">
            <h1 className={headingClasses}>
              JT Academy
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">AI 기반 학습 파트너</p>
          </div>
        </header>
        <main className={cardClasses}>
          <AuthScreen />
        </main>
        <footer className={footerClasses}>
          <p>&copy; {new Date().getFullYear()} AI Learning Tool. All rights reserved.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <header className={headerWrapperClasses}>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
          {/* Left: Certification Selector */}
          <div className="w-full md:w-auto flex justify-start">
            <select
              value={selectedCertification}
              onChange={(e) => setSelectedCertification(e.target.value as Certification)}
              className="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-md px-3 py-1 text-sm font-medium hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              {CERTIFICATIONS.map((cert) => (
                <option key={cert} value={cert}>
                  {cert}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-center mb-4">
          <h1 className={headingClasses}>
            {selectedCertification} 학습하기
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">AI 기반 학습 파트너</p>
        </div>
      </header>
      <main className={cardClasses}>
        {/* Actions moved to Card */}
        <div className="w-full flex justify-end items-center gap-3 text-sm mb-6 border-b pb-4 dark:border-slate-700">
          {isAdmin(session) && (
            <button
              onClick={() => navigate('ai-variant-generator')}
              className="bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-1 px-3 rounded-md transition-colors flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              문제 UPLOAD
            </button>
          )}
          <span className={`text-slate-600 dark:text-slate-300${isMobile ? ' hidden' : ''}`}>
            {session.user.email}
          </span>
          {currentScreen === 'quiz' ? (
            <button onClick={() => navigate(quizReturnScreen)} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold py-1 px-3 rounded-md transition-colors">
              퀴즈 종료
            </button>
          ) : currentScreen === 'subject-select' || currentScreen === 'wrong-note' ? (
            <button onClick={() => navigate('dashboard')} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold py-1 px-3 rounded-md transition-colors">
              메인으로
            </button>
          ) : (
            <button onClick={handleLogout} className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold py-1 px-3 rounded-md transition-colors">
              로그아웃
            </button>
          )}
        </div>
        {renderScreen()}
      </main>
      <footer className={footerClasses}>
        <p>&copy; {new Date().getFullYear()} AI Learning Tool. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;
