import { supabase } from './supabaseClient';

export const wrongAnswerService = {
  upsertWrongAnswer: async (userId: string, questionId: number): Promise<void> => {
    try {
      const { data: existing, error: selectError } = await supabase
        .from('wrong_answers')
        .select('id, wrong_count')
        .eq('user_id', userId)
        .eq('question_id', questionId)
        .single();

      if (selectError && selectError.code !== 'PGRST116') {
        console.error('Error fetching wrong answer:', selectError);
        return;
      }

      if (existing) {
        const { error: updateError } = await supabase
          .from('wrong_answers')
          .update({ wrong_count: existing.wrong_count + 1 })
          .eq('id', existing.id);

        if (updateError) {
          console.error('Error updating wrong answer:', updateError);
        }
      } else {
        const { error: insertError } = await supabase.from('wrong_answers').insert({
          user_id: userId,
          question_id: questionId,
          added_date: new Date().toISOString(),
          wrong_count: 1,
        });

        if (insertError) {
          console.error('Error inserting wrong answer:', insertError);
        }
      }
    } catch (error) {
      console.error('Unexpected error upserting wrong answer:', error);
    }
  }
};
