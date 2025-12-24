import { Session } from '@supabase/supabase-js';

export interface QuestionModel {
  id: number;
  subject: string;
  year: number;
  questionText: string;
  questionNumber?: number | null;
  options: string[];
  answerIndex: number;
  aiExplanation: string | null;
  isVariant?: boolean;
  parentQuestionId?: number;
  hint?: string;
  rationale?: string;
  certification?: string;  // 자격증 구분 (e.g., "전기기사", "신재생에너지발전설비기사(태양광)")

  // Topic classification (AI-generated)
  topicCategory?: string;           // e.g., "키르히호프 법칙"
  topicKeywords?: string[];         // e.g., ["KVL", "KCL", "전압"]
  frequency?: number;                // Auto-calculated appearance count
  difficultyLevel?: 'easy' | 'medium' | 'hard';

  // Supabase Storage URLs
  imageUrl?: string;                // URL to original question image in Storage
  textFileUrl?: string;             // URL to extracted text file in Storage
  diagramUrl?: string;              // URL to cropped diagram image in Storage
  diagramBounds?: {                 // Coordinates of the diagram in the original image
    x: number;
    y: number;
    width: number;
    height: number;
  };
  needsManualDiagram?: boolean;     // Flag for questions that need manual diagram insertion (e.g., from DOCX)
}

export interface UserQuizRecord {
  userId?: string;
  questionId: number;
  userAnswerIndex: number;
  isCorrect: boolean;
  solvedDate: Date;
}

export interface WrongAnswerModel {
  recordId: number;
  questionId: number;
  addedDate: Date;
  wrongCount: number;
}

export interface LearningProgress {
  totalQuestions: number;
  solvedQuestions: number;
  completionRate: number;
  subjectStats: {
    subject: string;
    correct: number;
    total: number;
    accuracy: number;
    solvedCount: number;
    totalCount: number;
  }[];
  totalWrongAnswers: number;
}

export interface TopicStats {
  subject: string;
  topicCategory: string;
  questionCount: number;        // Frequency (number of questions)
  years: number[];              // Which years it appeared
  averageAccuracy?: number;     // Optional: user performance
}

export type Screen = 'dashboard' | 'quiz' | 'wrong-note' | 'subject-select' | 'ai-variant-generator' | 'admin-questions';

export type AuthSession = Session;

export interface AnalyzedQuestionResponse {
  target_question_number: string;
  original_analysis: {
    subject: string;
    topic: string;
    key_formula: string;
  };
}

export interface GeneratedVariantProblem {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
}

export interface QuizAnswerOption {
  text: string;
  rationale: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  questionNumber: number;
  question: string;
  imageUrl?: string;
  hint: string;
  answerOptions: QuizAnswerOption[];
}

export interface Quiz {
  questions: QuizQuestion[];
}

export interface CertificationStandardFileMeta {
  id: number;
  standardId: number;
  url: string;
  originalFilename: string | null;
  fileType: string | null;
  fileSize: number | null;
  pageCount: number | null;
  sortIndex: number;
  createdAt: Date;
}

export interface CertificationStandardSection {
  id: number;
  standardId: number;
  sectionIndex: number;
  startPage: number | null;
  endPage: number | null;
  content: string;
  charCount: number | null;
  tokenEstimate: number | null;
  createdAt: Date;
}

export interface CertificationStandard {
  id: number;
  certification: string;
  subject: string;
  pdfUrl: string;
  extractedText: string | null;
  files?: CertificationStandardFileMeta[];
  sections?: CertificationStandardSection[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveCertificationStandardInput {
  certification: string;
  subject: string;
  pdfUrl?: string;
  extractedText: string;
  files: Array<{
    url: string;
    originalFilename: string;
    fileType: string;
    fileSize: number;
    pageCount: number | null;
  }>;
  sections: Array<{
    sectionIndex: number;
    startPage: number | null;
    endPage: number | null;
    content: string;
    charCount: number;
    tokenEstimate: number;
  }>;
}

export interface StudyPlan {
  id: string;
  userId: string;
  courseType: '60_day' | '90_day';
  startDate: Date;
  currentDay: number;
  status: 'active' | 'completed' | 'abandoned';
  certification: string;
}

export interface DailyStudyLog {
  id: string;
  planId: string;
  dayNumber: number;
  completedReading: boolean;
  completedReview: boolean;
  completedMock: boolean;
  targetSubjects: string[];
  readingQuestionIds?: number[];
  reviewQuestionIds?: number[];
  readingTargetCount?: number | null;
  reviewTargetCount?: number | null;
}
