import {
  QuestionModel,
  UserQuizRecord,
  WrongAnswerModel,
  LearningProgress,
  CertificationStandard,
  SaveCertificationStandardInput
} from '../types';
import { supabase } from './supabaseClient';
import { subjects, getSubjectsByCertification, SUBJECT_TOPICS, CERTIFICATION_SUBJECTS } from '../constants';

const MISSING_STANDARD_TABLE_HINT =
  'Supabase 테이블 certification_standard_files / certification_standard_sections가 아직 생성되지 않았습니다. 최신 migration을 supabase에 적용해주세요.';

const isMissingStandardTableError = (error: any): boolean => {
  const message = error?.message ?? '';
  if (typeof message !== 'string') return false;
  return (
    message.includes('certification_standard_files') ||
    message.includes('certification_standard_sections')
  );
};

const mapCertificationStandard = (item: any): CertificationStandard => {
  const files = (item.certification_standard_files || [])
    .sort((a: any, b: any) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
    .map((file: any) => ({
      id: file.id,
      standardId: file.standard_id,
      url: file.storage_url,
      originalFilename: file.original_filename,
      fileType: file.file_type,
      fileSize: file.file_size,
      pageCount: file.page_count,
      sortIndex: file.sort_index ?? 0,
      createdAt: new Date(file.created_at)
    }));

  const sections = (item.certification_standard_sections || [])
    .sort((a: any, b: any) => (a.section_index ?? 0) - (b.section_index ?? 0))
    .map((section: any) => ({
      id: section.id,
      standardId: section.standard_id,
      sectionIndex: section.section_index,
      startPage: section.start_page,
      endPage: section.end_page,
      content: section.content,
      charCount: section.char_count,
      tokenEstimate: section.token_estimate,
      createdAt: new Date(section.created_at)
    }));

  return {
    id: item.id,
    certification: item.certification,
    subject: item.subject,
    pdfUrl: item.pdf_url,
    extractedText: item.extracted_text,
    files,
    sections,
    createdAt: new Date(item.created_at),
    updatedAt: new Date(item.updated_at)
  };
};

export const quizApi = {
  loadQuestions: async ({ subject, year, topic, certification }: { subject?: string; year?: number; topic?: string; certification?: string }): Promise<QuestionModel[]> => {
    let query = supabase.from('questions').select('*');
    if (subject) {
      query = query.eq('subject', subject);
    }
    if (year) {
      query = query.eq('year', year);
    }
    if (topic) {
      if (topic === '기타' && subject && SUBJECT_TOPICS[subject]) {
        // For 'Other', fetch questions where topic is NOT in the known list
        // This includes literally '기타' and any other unclassified topics
        query = query.not('topic_category', 'in', `(${SUBJECT_TOPICS[subject].map(t => `"${t}"`).join(',')})`);
      } else {
        query = query.eq('topic_category', topic);
      }
    }
    if (certification) {
      query = query.eq('certification', certification);
    }

    // Order by created_at desc to show newest first
    const { data, error } = await query.order('created_at', { ascending: false });

    console.log(`[quizApi] loadQuestions: Fetched ${data?.length} questions. Subject: ${subject || 'ALL'}, Certification: ${certification || 'ALL'}`);

    if (error) {
      console.error('Error loading questions:', error);
      return [];
    }

    return data.map(item => ({
      id: item.id,
      subject: item.subject,
      year: item.year,
      questionText: item.question_text,
      options: item.options,
      answerIndex: item.answer_index,
      aiExplanation: item.ai_explanation,
      isVariant: item.is_variant,
      parentQuestionId: item.parent_question_id,
      hint: item.hint,
      rationale: item.rationale,
      topicCategory: item.topic_category,
      topicKeywords: item.topic_keywords,
      frequency: item.frequency,
      difficultyLevel: item.difficulty_level,
      imageUrl: item.image_url,
      textFileUrl: item.text_file_url,
      diagramUrl: item.diagram_url,
      certification: item.certification
    }));
  },

  getTopicStatistics: async (subject?: string): Promise<import('../types').TopicStats[]> => {
    const questions = await quizApi.loadQuestions({ subject });

    const topicMap = new Map<string, import('../types').TopicStats>();

    questions.forEach(q => {
      if (!q.topicCategory) return;

      const key = q.topicCategory;

      if (topicMap.has(key)) {
        const stats = topicMap.get(key)!;
        stats.questionCount++;
        if (!stats.years.includes(q.year)) {
          stats.years.push(q.year);
        }
      } else {
        topicMap.set(key, {
          subject: q.subject,
          topicCategory: q.topicCategory,
          questionCount: 1,
          years: [q.year],
        });
      }
    });

    return Array.from(topicMap.values())
      .sort((a, b) => b.questionCount - a.questionCount);
  },

  getQuestionById: async (id: number): Promise<QuestionModel | undefined> => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching question:', error);
      return undefined;
    }

    return {
      id: data.id,
      subject: data.subject,
      year: data.year,
      questionText: data.question_text,
      options: data.options,
      answerIndex: data.answer_index,
      aiExplanation: data.ai_explanation,
      isVariant: data.is_variant,
      parentQuestionId: data.parent_question_id,
      hint: data.hint,
      rationale: data.rationale,
      imageUrl: data.image_url,
      textFileUrl: data.text_file_url,
      diagramUrl: data.diagram_url,
      certification: data.certification
    };
  },

  saveRecord: async (record: Omit<UserQuizRecord, 'solvedDate'>, userId: string): Promise<void> => {
    const newRecord = {
      ...record,
      user_id: userId,
      question_id: record.questionId,
      user_answer_index: record.userAnswerIndex,
      is_correct: record.isCorrect,
      solved_date: new Date().toISOString()
    };

    // remove properties that are not in the table
    delete (newRecord as any).questionId;
    delete (newRecord as any).userAnswerIndex;
    delete (newRecord as any).isCorrect;


    const { error: recordError } = await supabase.from('user_quiz_records').insert(newRecord);
    if (recordError) console.error('Error saving record:', recordError);

    if (!newRecord.is_correct) {
      // Check if a wrong answer record already exists
      const { data: existing, error: selectError } = await supabase
        .from('wrong_answers')
        .select('id, wrong_count')
        .eq('user_id', userId)
        .eq('question_id', record.questionId)
        .single();

      if (selectError && selectError.code !== 'PGRST116') { // PGRST116: no rows found
        console.error('Error fetching wrong answer:', selectError);
        return;
      }

      if (existing) {
        // Increment wrong_count
        const { error: updateError } = await supabase
          .from('wrong_answers')
          .update({ wrong_count: existing.wrong_count + 1 })
          .eq('id', existing.id);
        if (updateError) console.error('Error updating wrong answer:', updateError);
      } else {
        // Create new wrong answer record
        const { error: insertError } = await supabase.from('wrong_answers').insert({
          user_id: userId,
          question_id: record.questionId,
          added_date: new Date().toISOString(),
          wrong_count: 1,
        });
        if (insertError) console.error('Error inserting wrong answer:', insertError);
      }
    }
  },

  generateMockTest: async (numberOfQuestions: number, certification?: string): Promise<QuestionModel[]> => {
    // Real exam format: 20 questions per subject × 5 subjects = 100 questions
    const questionsPerSubject = 20;
    const allQuestions = await quizApi.getAllQuestions();

    // Filter by certification if provided
    const certQuestions = certification
      ? allQuestions.filter(q => q.certification === certification)
      : allQuestions;

    // Get subjects for this certification
    const certSubjects = certification && CERTIFICATION_SUBJECTS[certification]
      ? CERTIFICATION_SUBJECTS[certification]
      : subjects;

    // Group questions by subject
    const questionsBySubject: Record<string, QuestionModel[]> = {};
    certSubjects.forEach(subject => {
      questionsBySubject[subject] = certQuestions.filter(q => q.subject === subject);
    });

    // Select 20 random questions from each subject
    const mockTestQuestions: QuestionModel[] = [];
    certSubjects.forEach(subject => {
      const subjectQuestions = questionsBySubject[subject] || [];
      const shuffled = subjectQuestions.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, questionsPerSubject);
      mockTestQuestions.push(...selected);
    });

    // Shuffle all questions so subjects are mixed
    return mockTestQuestions.sort(() => 0.5 - Math.random());
  },

  getWrongAnswers: async (userId: string): Promise<WrongAnswerModel[]> => {
    const { data, error } = await supabase
      .from('wrong_answers')
      .select('id, question_id, added_date, wrong_count')
      .eq('user_id', userId)
      .order('wrong_count', { ascending: false });

    if (error) {
      console.error('Error fetching wrong answers:', error);
      return [];
    }
    return data.map(item => ({
      recordId: item.id,
      questionId: item.question_id,
      addedDate: new Date(item.added_date),
      wrongCount: item.wrong_count,
    }));
  },

  getAllQuestions: async (): Promise<QuestionModel[]> => {
    const { data, error } = await supabase.from('questions').select('*');

    if (error) {
      console.error('Error fetching all questions:', error);
      return [];
    }

    return data.map(item => ({
      id: item.id,
      subject: item.subject,
      year: item.year,
      questionText: item.question_text,
      options: item.options,
      answerIndex: item.answer_index,
      aiExplanation: item.ai_explanation,
      isVariant: item.is_variant,
      parentQuestionId: item.parent_question_id,
      hint: item.hint,
      rationale: item.rationale,
      imageUrl: item.image_url,
      textFileUrl: item.text_file_url,
      diagramUrl: item.diagram_url,
      certification: item.certification
    }));
  },

  getAllRecords: async (userId: string): Promise<UserQuizRecord[]> => {
    const { data, error } = await supabase
      .from('user_quiz_records')
      .select('question_id, user_answer_index, is_correct, solved_date')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching records:', error);
      return [];
    }

    return data.map(item => ({
      questionId: item.question_id,
      userAnswerIndex: item.user_answer_index,
      isCorrect: item.is_correct,
      solvedDate: new Date(item.solved_date)
    }));
  },

  getLearningProgress: async (userId: string, certification?: string): Promise<LearningProgress> => {
    const allQuestions = await quizApi.getAllQuestions();
    const allRecords = await quizApi.getAllRecords(userId);
    const wrongAnswers = await quizApi.getWrongAnswers(userId);

    // Filter questions by certification if provided
    const relevantQuestions = certification
      ? allQuestions.filter(q => q.certification === certification)
      : allQuestions;

    const relevantQuestionIds = new Set(relevantQuestions.map(q => q.id));

    // Filter records and wrong answers based on relevant questions
    const relevantRecords = allRecords.filter(r => relevantQuestionIds.has(r.questionId));
    const relevantWrongAnswers = wrongAnswers.filter(wa => relevantQuestionIds.has(wa.questionId));

    const solvedQuestionIds = new Set(relevantRecords.map(r => r.questionId));

    const subjectStats: { [key: string]: { correct: number, totalAttempts: number, solvedIds: Set<number>, totalQuestions: number } } = {};

    // Initialize stats for relevant subjects only
    // If certification is provided, use its subjects. Otherwise use all subjects.
    const targetSubjects = certification
      ? getSubjectsByCertification(certification as any)
      : subjects;

    targetSubjects.forEach(subject => {
      subjectStats[subject] = { correct: 0, totalAttempts: 0, solvedIds: new Set(), totalQuestions: 0 };
    });

    // Count questions per subject
    relevantQuestions.forEach(q => {
      if (subjectStats[q.subject]) {
        subjectStats[q.subject].totalQuestions++;
      }
    });

    // Count records per subject
    for (const record of relevantRecords) {
      const question = relevantQuestions.find(q => q.id === record.questionId);
      if (question && subjectStats[question.subject]) {
        subjectStats[question.subject].totalAttempts++;
        if (record.isCorrect) {
          subjectStats[question.subject].correct++;
        }
        subjectStats[question.subject].solvedIds.add(record.questionId);
      }
    }

    const totalQuestions = relevantQuestions.length;
    const solvedQuestions = solvedQuestionIds.size;
    const completionRate = totalQuestions > 0 ? (solvedQuestions / totalQuestions) * 100 : 0;

    return {
      completionRate,
      subjectStats: Object.entries(subjectStats).map(([subject, stats]) => ({
        subject,
        correct: stats.correct,
        total: stats.totalAttempts,
        accuracy: stats.totalAttempts > 0 ? (stats.correct / stats.totalAttempts) * 100 : 0,
        solvedCount: stats.solvedIds.size,
        totalCount: stats.totalQuestions
      })),
      totalWrongAnswers: relevantWrongAnswers.length,
      solvedQuestions,
      totalQuestions
    };
  },

  saveQuestion: async (question: Omit<QuestionModel, 'id'>): Promise<QuestionModel> => {
    const { data, error } = await supabase
      .from('questions')
      .insert({
        subject: question.subject,
        year: question.year,
        question_text: question.questionText,
        options: question.options,
        answer_index: question.answerIndex,
        ai_explanation: question.aiExplanation,
        is_variant: question.isVariant || false,
        parent_question_id: question.parentQuestionId || null,
        topic_category: question.topicCategory || null,
        topic_keywords: question.topicKeywords || [],
        frequency: question.frequency || 0,
        difficulty_level: question.difficultyLevel || 'medium',
        hint: question.hint || null,
        rationale: question.rationale || null,
        image_url: question.imageUrl || null,
        text_file_url: question.textFileUrl || null,
        diagram_url: question.diagramUrl || null,
        certification: question.certification || '전기기사'
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving question:', error);
      throw new Error('Failed to save question');
    }

    return {
      id: data.id,
      subject: data.subject,
      year: data.year,
      questionText: data.question_text,
      options: data.options,
      answerIndex: data.answer_index,
      aiExplanation: data.ai_explanation,
      isVariant: data.is_variant,
      parentQuestionId: data.parent_question_id,
      topicCategory: data.topic_category,
      topicKeywords: data.topic_keywords,
      frequency: data.frequency,
      difficultyLevel: data.difficulty_level,
      hint: data.hint,
      rationale: data.rationale,
      imageUrl: data.image_url,
      textFileUrl: data.text_file_url,
      diagramUrl: data.diagram_url,
      certification: data.certification
    };
  },

  getVariantsByParentId: async (parentId: number): Promise<QuestionModel[]> => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('parent_question_id', parentId)
      .eq('is_variant', true);

    if (error) {
      console.error('Error fetching variants:', error);
      return [];
    }

    return data.map(item => ({
      id: item.id,
      subject: item.subject,
      year: item.year,
      questionText: item.question_text,
      options: item.options,
      answerIndex: item.answer_index,
      aiExplanation: item.ai_explanation,
      isVariant: item.is_variant,
      parentQuestionId: item.parent_question_id,
      hint: item.hint,
      rationale: item.rationale,
      imageUrl: item.image_url,
      textFileUrl: item.text_file_url
    }));
  },

  checkDuplicates: async (questionTexts: string[]): Promise<string[]> => {
    if (questionTexts.length === 0) return [];

    // Supabase .in() filter has a limit (usually around 65535 parameters, but URL length is also a factor)
    // For safety, we can chunk if the list is huge, but for 10-20 questions it's fine.
    const { data, error } = await supabase
      .from('questions')
      .select('question_text')
      .in('question_text', questionTexts);

    if (error) {
      console.error('Error checking duplicates:', error);
      return [];
    }

    return data.map(item => item.question_text);
  },

  // Certification Standards API
  getCertificationStandards: async (certification: string, subject?: string): Promise<CertificationStandard[]> => {
    let query = supabase
      .from('certification_standards')
      .select(`
        *,
        certification_standard_files (*),
        certification_standard_sections (*)
      `)
      .eq('certification', certification);

    if (subject) {
      query = query.eq('subject', subject);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching certification standards:', error);
      return [];
    }

    return data.map(mapCertificationStandard);
  },

  saveCertificationStandard: async (standard: SaveCertificationStandardInput): Promise<CertificationStandard> => {
    const { data, error } = await supabase
      .from('certification_standards')
      .upsert(
        {
          certification: standard.certification,
          subject: standard.subject,
          pdf_url: standard.pdfUrl || '',
          extracted_text: standard.extractedText
        },
        {
          onConflict: 'certification,subject'
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error saving certification standard:', error);
      throw new Error(`Failed to save certification standard: ${error.message ?? error}`);
    }

    const standardId = data.id;

    const { error: deleteFilesError } = await supabase
      .from('certification_standard_files')
      .delete()
      .eq('standard_id', standardId);

    if (deleteFilesError) {
      console.error('Error clearing existing standard files:', deleteFilesError);
      if (isMissingStandardTableError(deleteFilesError)) {
        throw new Error(MISSING_STANDARD_TABLE_HINT);
      }
      throw new Error(`Failed to reset standard files: ${deleteFilesError.message ?? deleteFilesError}`);
    }

    if (standard.files.length > 0) {
      const fileRows = standard.files.map((file, index) => ({
        standard_id: standardId,
        storage_url: file.url,
        original_filename: file.originalFilename,
        file_type: file.fileType,
        file_size: file.fileSize,
        page_count: file.pageCount,
        sort_index: index
      }));

      const { error: insertFilesError } = await supabase
        .from('certification_standard_files')
        .insert(fileRows);

      if (insertFilesError) {
        console.error('Error inserting standard files:', insertFilesError);
        if (isMissingStandardTableError(insertFilesError)) {
          throw new Error(MISSING_STANDARD_TABLE_HINT);
        }
        throw new Error(`Failed to save standard files: ${insertFilesError.message ?? insertFilesError}`);
      }
    }

    const { error: deleteSectionsError } = await supabase
      .from('certification_standard_sections')
      .delete()
      .eq('standard_id', standardId);

    if (deleteSectionsError) {
      console.error('Error clearing existing standard sections:', deleteSectionsError);
      if (isMissingStandardTableError(deleteSectionsError)) {
        throw new Error(MISSING_STANDARD_TABLE_HINT);
      }
      throw new Error(`Failed to reset standard sections: ${deleteSectionsError.message ?? deleteSectionsError}`);
    }

    if (standard.sections.length > 0) {
      const sectionRows = standard.sections.map(section => ({
        standard_id: standardId,
        section_index: section.sectionIndex,
        start_page: section.startPage,
        end_page: section.endPage,
        content: section.content,
        char_count: section.charCount,
        token_estimate: section.tokenEstimate
      }));

      const { error: insertSectionsError } = await supabase
        .from('certification_standard_sections')
        .insert(sectionRows);

      if (insertSectionsError) {
        console.error('Error inserting standard sections:', insertSectionsError);
        if (isMissingStandardTableError(insertSectionsError)) {
          throw new Error(MISSING_STANDARD_TABLE_HINT);
        }
        throw new Error(`Failed to save standard sections: ${insertSectionsError.message ?? insertSectionsError}`);
      }
    }

    const { data: refreshed, error: refreshError } = await supabase
      .from('certification_standards')
      .select(`
        *,
        certification_standard_files (*),
        certification_standard_sections (*)
      `)
      .eq('id', standardId)
      .single();

    if (refreshError) {
      console.error('Error refreshing certification standard:', refreshError);
      if (isMissingStandardTableError(refreshError)) {
        throw new Error(MISSING_STANDARD_TABLE_HINT);
      }
      throw new Error(`Failed to load saved certification standard: ${refreshError.message ?? refreshError}`);
    }

    return mapCertificationStandard(refreshed);
  },

  deleteCertificationStandard: async (id: number): Promise<void> => {
    const { error } = await supabase
      .from('certification_standards')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting certification standard:', error);
      throw new Error('Failed to delete certification standard');
    }
  }
};
