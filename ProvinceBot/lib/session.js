import { supabase } from './supabase.js';

export function SupabaseSession(options = {}) {
    return async (ctx, next) => {
        const key = ctx.from?.id != null ? ctx.from.id.toString() : null;
        if (!key) {
            return await next();
        }

        let session = {};
        
        // Fetch session
        try {
            const { data, error } = await supabase
                .from('bot_sessions')
                .select('session_data')
                .eq('id', key)
                .single();
                
            if (data && data.session_data) {
                session = data.session_data;
            }
        } catch (err) {
            console.error('Session fetch error', err);
        }

        Object.defineProperty(ctx, 'session', {
            get: function () { return session; },
            set: function (newValue) { session = Object.assign({}, newValue); }
        });

        await next();

        // Save session
        try {
            await supabase
                .from('bot_sessions')
                .upsert({ id: key, session_data: session });
        } catch (err) {
            console.error('Session save error', err);
        }
    };
}
