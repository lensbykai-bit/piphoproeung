window.DRAMAVERSE_SUPABASE = {
  url: 'https://ngcdpenpzqydjmltglnu.supabase.co',
  publishableKey: 'sb_publishable_itiKIpvW0wgBL5Fpt3DoQQ_nm5sVz2t'
};

if (window.supabase && window.DRAMAVERSE_SUPABASE) {
  const { url, publishableKey } = window.DRAMAVERSE_SUPABASE;
  window.dvSupabase = window.supabase.createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}
