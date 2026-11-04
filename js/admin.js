(() => {
  const db = window.dvSupabase;
  const $ = (id) => document.getElementById(id);

  const authView = $('authView');
  const activationView = $('activationView');
  const dashboardView = $('dashboardView');
  const statusBox = $('statusBox');
  const movieForm = $('movieForm');
  const movieList = $('movieList');
  const settingsForm = $('settingsForm');
  const currentUser = $('currentUser');
  const paymentSettingsForm = $('paymentSettingsForm');
  const ordersList = $('ordersList');

  let editingId = null;
  const ADMIN_REDIRECT_URL = new URL('admin.html', location.href).href;

  function showStatus(message, type = 'info') {
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.className = `status ${type}`;
    statusBox.hidden = false;
  }

  function clearStatus() {
    if (statusBox) statusBox.hidden = true;
  }

  function showOnly(view) {
    [authView, activationView, dashboardView].forEach(el => {
      if (el) el.hidden = el !== view;
    });
  }

  function categoriesFromForm() {
    return [...document.querySelectorAll('input[name="category"]:checked')].map(el => el.value);
  }

  function setCategories(values = []) {
    const set = new Set((values || []).map(v => String(v).toLowerCase()));
    document.querySelectorAll('input[name="category"]').forEach(el => {
      el.checked = set.has(el.value.toLowerCase());
    });
  }

  async function getSession() {
    if (!db) return null;
    const { data } = await db.auth.getSession();
    return data.session || null;
  }

  async function isCurrentUserAdmin(user) {
    if (!user) return false;
    const { data, error } = await db
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return false;
    return !!data;
  }

  async function routeSession(session) {
    clearStatus();
    if (!session?.user) {
      showOnly(authView);
      return;
    }

    if (currentUser) currentUser.textContent = session.user.email || session.user.id;
    const admin = await isCurrentUserAdmin(session.user);
    if (!admin) {
      showOnly(activationView);
      return;
    }

    showOnly(dashboardView);
    await Promise.all([loadMovies(), loadSettings(), loadPaymentSettings(), loadOrders()]);
  }

  async function login(event) {
    event.preventDefault();
    clearStatus();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return showStatus(error.message, 'error');
    showStatus('ចូល Admin បានជោគជ័យ។', 'success');
    await routeSession(data.session);
  }

  async function signup(event) {
    event.preventDefault();
    clearStatus();
    const email = $('signupEmail').value.trim();
    const password = $('signupPassword').value;
    if (password.length < 8) return showStatus('Password ត្រូវមានយ៉ាងតិច 8 តួអក្សរ។', 'error');

    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: ADMIN_REDIRECT_URL }
    });
    if (error) return showStatus(error.message, 'error');

    if (data.session) {
      showStatus('Account ត្រូវបានបង្កើត។ សូមបញ្ចូល Setup Code ដើម្បីបើក Admin។', 'success');
      await routeSession(data.session);
    } else {
      showStatus('Account ត្រូវបានបង្កើត។ សូមបញ្ជាក់ Email រួចត្រឡប់មក Login វិញ។', 'success');
    }
  }

  async function resendConfirmation() {
    clearStatus();
    const email = $('signupEmail').value.trim();
    if (!email) return showStatus('សូមបញ្ចូល Email ជាមុនសិន។', 'error');

    const { error } = await db.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: ADMIN_REDIRECT_URL }
    });

    if (error) return showStatus(error.message, 'error');
    showStatus('បានផ្ញើ Link បញ្ជាក់ Email ថ្មីរួចហើយ។ សូមប្រើ Link ថ្មីបំផុត។', 'success');
  }

  async function activateAdmin(event) {
    event.preventDefault();
    clearStatus();
    const code = $('setupCode').value.trim();
    if (!code) return showStatus('សូមបញ្ចូល Setup Code។', 'error');

    const { error } = await db.rpc('claim_admin', { p_code: code });
    if (error) return showStatus('Setup Code មិនត្រឹមត្រូវ ឬ Admin បានបង្កើតរួចហើយ។', 'error');

    showStatus('Admin ត្រូវបានបើករួចហើយ។', 'success');
    const session = await getSession();
    await routeSession(session);
  }

  async function logout() {
    await db.auth.signOut();
    showOnly(authView);
    showStatus('បានចាកចេញពី Admin។', 'success');
  }

  async function loadSettings() {
    const { data, error } = await db
      .from('site_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) return;
    $('siteName').value = data.site_name || 'DramaVerse';
    $('telegramUrl').value = data.telegram_url || '';
    $('heroBadge').value = data.hero_badge || '';
    $('heroTitle').value = data.hero_title || '';
    $('heroDescription').value = data.hero_description || '';
    $('heroButtonText').value = data.hero_button_text || '';
  }

  async function saveSettings(event) {
    event.preventDefault();
    clearStatus();
    const payload = {
      site_name: $('siteName').value.trim() || 'DramaVerse',
      telegram_url: $('telegramUrl').value.trim(),
      hero_badge: $('heroBadge').value.trim(),
      hero_title: $('heroTitle').value.trim(),
      hero_description: $('heroDescription').value.trim(),
      hero_button_text: $('heroButtonText').value.trim(),
      updated_at: new Date().toISOString()
    };

    const { error } = await db.from('site_settings').update(payload).eq('id', 1);
    if (error) return showStatus(error.message, 'error');
    showStatus('បានរក្សាទុកការកែ Website រួចហើយ។', 'success');
  }

  async function loadPaymentSettings() {
    if (!paymentSettingsForm) return;

    const [publicResult, bakongResult] = await Promise.all([
      db.from('payment_settings')
        .select('khqr_expiry_minutes')
        .eq('id', 1)
        .maybeSingle(),
      db.from('bakong_config')
        .select('account_id,merchant_name,merchant_city,enabled')
        .eq('id', 1)
        .maybeSingle()
    ]);

    const publicData = publicResult.data || {};
    const bakong = bakongResult.data || {};

    $('bakongAccountId').value = bakong.account_id || '';
    $('bakongMerchantName').value = bakong.merchant_name || 'DramaVerse';
    $('bakongMerchantCity').value = bakong.merchant_city || 'PHNOM PENH';
    $('bakongExpiryMinutes').value = publicData.khqr_expiry_minutes || 15;
    $('bakongAutoEnabled').checked = bakong.enabled !== false;
    $('bakongApiToken').value = '';
  }

  async function savePaymentSettings(event) {
    event.preventDefault();
    clearStatus();

    const accountId = $('bakongAccountId').value.trim();
    const merchantName = $('bakongMerchantName').value.trim() || 'DramaVerse';
    const merchantCity = $('bakongMerchantCity').value.trim() || 'PHNOM PENH';
    const expiry = Math.min(60, Math.max(1, Number($('bakongExpiryMinutes').value || 15)));
    const enabled = $('bakongAutoEnabled').checked;
    const newToken = $('bakongApiToken').value.trim();

    if (enabled && !accountId) {
      return showStatus('សូមបញ្ចូល Bakong Account ID។', 'error');
    }

    const now = new Date().toISOString();
    const publicPayload = {
      provider_name: 'KHQR',
      khqr_mode: 'individual',
      bakong_account_id: accountId,
      merchant_name: merchantName,
      merchant_city: merchantCity,
      store_label: 'DramaVerse',
      terminal_label: 'WEB',
      merchant_category_code: '5999',
      khqr_expiry_minutes: expiry,
      account_label: 'Auto KHQR',
      instructions: 'ស្កេន KHQR ហើយបង់តាមចំនួនទឹកប្រាក់ដែលបានបង្ហាញ។ ប្រព័ន្ធនឹងពិនិត្យការទូទាត់ដោយស្វ័យប្រវត្តិ។',
      enabled,
      updated_at: now
    };

    const bakongPayload = {
      id: 1,
      api_base_url: 'https://api-bakong.nbc.gov.kh',
      account_id: accountId,
      merchant_name: merchantName,
      merchant_city: merchantCity,
      enabled,
      updated_at: now
    };

    if (newToken) bakongPayload.api_token = newToken;

    const [publicResult, bakongResult] = await Promise.all([
      db.from('payment_settings').update(publicPayload).eq('id', 1),
      db.from('bakong_config').upsert(bakongPayload, { onConflict: 'id' })
    ]);

    const error = publicResult.error || bakongResult.error;
    if (error) return showStatus(error.message, 'error');

    $('bakongApiToken').value = '';
    showStatus('បានរក្សាទុក Auto KHQR រួចហើយ។ Order ថ្មីនឹងបង្កើត QR និងពិនិត្យ Paid ដោយស្វ័យប្រវត្តិ។', 'success');
  }

  async function loadOrders() {
    if (!ordersList) return;

    const { data, error } = await db
      .from('orders')
      .select('id,order_code,movie_title,amount_khr,currency,status,customer_contact,created_at,paid_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      ordersList.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!data?.length) {
      ordersList.innerHTML = '<div class="empty">មិនទាន់មាន Order ទេ។</div>';
      return;
    }

    const money = value => new Intl.NumberFormat('km-KH').format(Number(value || 0)) + '៛';

    ordersList.innerHTML = data.map(order => `
      <article class="order-row" data-order-id="${order.id}">
        <div class="order-main">
          <strong>${escapeHtml(order.order_code)} · ${escapeHtml(order.movie_title)}</strong>
          <span>${money(order.amount_khr)} · ${new Date(order.created_at).toLocaleString()}</span>
          <small>${escapeHtml(order.customer_contact || 'No contact')}</small>
        </div>
        <div class="order-actions">
          <span class="pill ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
          
        </div>
      </article>
    `).join('');

    // Payment state is read-only here. Only the trusted payment backend may verify and settle orders.
  }

  function resetMovieForm() {
    editingId = null;
    movieForm.reset();
    $('movieRating').value = '4.9';
    $('moviePrice').value = '2,000៛';
    $('movieEpisode').value = 'រឿងពេញ';
    $('movieBadge').value = 'NEW';
    $('movieSort').value = '0';
    $('moviePublished').checked = true;
    setCategories(['new']);
    $('movieFormTitle').textContent = '➕ បន្ថែមរឿងថ្មី';
    $('cancelEdit').hidden = true;
  }

  async function saveMovie(event) {
    event.preventDefault();
    clearStatus();

    const payload = {
      title: $('movieTitle').value.trim(),
      category: categoriesFromForm(),
      badge: $('movieBadge').value,
      price: $('moviePrice').value.trim() || '2,000៛',
      price_khr: Number(String($('moviePrice').value || '2000').replace(/[^0-9]/g, '')) || 2000,
      rating: Number($('movieRating').value || 4.9),
      episode: $('movieEpisode').value.trim() || 'រឿងពេញ',
      description: $('movieDescription').value.trim(),
      poster_url: $('moviePoster').value.trim(),
      sort_order: Number($('movieSort').value || 0),
      is_published: $('moviePublished').checked,
      updated_at: new Date().toISOString()
    };

    if (!payload.title) return showStatus('សូមបញ្ចូលចំណងជើងរឿង។', 'error');

    const telegramUrl = $('movieWatchUrl').value.trim() || '#';
    const movieId = editingId || `dv-${Date.now()}`;

    let error;
    if (editingId) {
      ({ error } = await db.from('movies').update(payload).eq('id', movieId));
    } else {
      payload.id = movieId;
      ({ error } = await db.from('movies').insert(payload));
    }

    if (error) return showStatus(error.message, 'error');

    const { error: deliveryError } = await db
      .from('movie_delivery')
      .upsert({
        movie_id: movieId,
        telegram_url: telegramUrl,
        updated_at: new Date().toISOString()
      }, { onConflict: 'movie_id' });

    if (deliveryError) return showStatus(deliveryError.message, 'error');
    showStatus(editingId ? 'បានកែរឿង និង Telegram Link រួចហើយ។' : 'បានបន្ថែមរឿងថ្មីរួចហើយ។', 'success');
    resetMovieForm();
    await loadMovies();
  }

  async function loadMovies() {
    const { data, error } = await db.rpc('admin_list_movies');

    if (error) {
      movieList.innerHTML = `<div class="empty">${error.message}</div>`;
      return;
    }

    if (!data?.length) {
      movieList.innerHTML = '<div class="empty">មិនទាន់មានរឿងទេ។</div>';
      return;
    }

    movieList.innerHTML = data.map(movie => `
      <article class="movie-row" data-id="${movie.id}">
        <div class="thumb" ${movie.poster_url ? `style="background-image:url('${String(movie.poster_url).replaceAll("'", '%27')}')"` : ''}></div>
        <div class="movie-row-main">
          <strong>${escapeHtml(movie.title)}</strong>
          <span>${escapeHtml((movie.category || []).join(' • '))} · ${escapeHtml(movie.price || '')} · ★ ${movie.rating}</span>
          <small>${movie.is_published ? '🟢 Published' : '⚪ Hidden'}</small>
        </div>
        <div class="row-actions">
          <button type="button" class="small-btn edit" data-action="edit">កែ</button>
          <button type="button" class="small-btn delete" data-action="delete">លុប</button>
        </div>
      </article>`).join('');

    movieList.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      const movie = data.find(item => item.id === id);
      editMovie(movie);
    }));

    movieList.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.closest('[data-id]').dataset.id;
      const movie = data.find(item => item.id === id);
      if (!confirm(`លុបរឿង “${movie?.title || id}” មែនទេ?`)) return;
      const { error: deleteError } = await db.from('movies').delete().eq('id', id);
      if (deleteError) return showStatus(deleteError.message, 'error');
      showStatus('បានលុបរឿងរួចហើយ។', 'success');
      await loadMovies();
    }));
  }

  function editMovie(movie) {
    if (!movie) return;
    editingId = movie.id;
    $('movieTitle').value = movie.title || '';
    $('movieBadge').value = movie.badge || 'NEW';
    $('moviePrice').value = movie.price || '';
    $('movieRating').value = movie.rating ?? 4.9;
    $('movieEpisode').value = movie.episode || '';
    $('movieDescription').value = movie.description || '';
    $('moviePoster').value = movie.poster_url || '';
    $('movieWatchUrl').value = movie.telegram_url || '';
    $('movieSort').value = movie.sort_order ?? 0;
    $('moviePublished').checked = !!movie.is_published;
    setCategories(movie.category || []);
    $('movieFormTitle').textContent = '✏️ កែរឿង';
    $('cancelEdit').hidden = false;
    movieForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  $('loginForm')?.addEventListener('submit', login);
  $('signupForm')?.addEventListener('submit', signup);
  $('resendConfirmBtn')?.addEventListener('click', resendConfirmation);
  $('activationForm')?.addEventListener('submit', activateAdmin);
  $('logoutBtn')?.addEventListener('click', logout);
  settingsForm?.addEventListener('submit', saveSettings);
  paymentSettingsForm?.addEventListener('submit', savePaymentSettings);
  $('refreshOrders')?.addEventListener('click', loadOrders);
  movieForm?.addEventListener('submit', saveMovie);
  $('cancelEdit')?.addEventListener('click', resetMovieForm);

  if (!db) {
    showStatus('Supabase មិនទាន់ភ្ជាប់។', 'error');
    return;
  }

  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => routeSession(session), 0);
  });

  const authHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (authHash.get('error_code') === 'otp_expired') {
    showStatus('Link បញ្ជាក់ Email បានផុតកំណត់។ សូមបង្កើត/ផ្ញើ Link ថ្មី ហើយចុច Link ថ្មីបំផុត។', 'error');
    history.replaceState(null, '', location.pathname + location.search);
  }

  resetMovieForm();
  getSession().then(routeSession);
})();
