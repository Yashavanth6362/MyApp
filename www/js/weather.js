/**
 * Weather.js – v2.3.0
 * A complete weather library with AI, UI, caching, and more.
 *
 * @license MIT
 * @author YASHAVANTH AN
 */

// ─── Constants ───
const Constants = {
  CACHE_TTL: 30 * 60 * 1000, // 30 minutes
  GEOLOCATION_TIMEOUT: 8000,  // 8 seconds
  DEFAULT_REFRESH: 15,        // minutes
  AMBIENT_VOLUME: 0.12,
  STORAGE_PREFIX: 'weather_',
  DEFAULT_THEME: 'auto',
  API_BASE: 'https://api.open-meteo.com/v1',
  GEOCODE_BASE: 'https://geocoding-api.open-meteo.com/v1',
  NOMINATIM_BASE: 'https://nominatim.openstreetmap.org',
  AQ_BASE: 'https://air-quality-api.open-meteo.com/v1',
};

// ─── Weather Object ───
const Weather = {
  // ─── Public Version ───
  version: '2.3.0',

  // ─── Internal State ───
  _state: {
    lastData: null,
    cityCoords: null,
    refreshInterval: null,
    widgetContainers: {},
    isOnline: true,
    isReady: false,
    ambientRunning: false,
    ambientCtx: null,
    ambientNodes: {},
    ambientTimer: null,
    ambientInterval: null,
    debug: false,
  },

  // ─── Configuration ───
  _config: {
    theme: Constants.DEFAULT_THEME,
    refresh: Constants.DEFAULT_REFRESH,
    sound: false,
    animation: true,
    units: 'c',
    gps: true,
    debug: false,
  },

  // ─── Event System ───
  _events: {},

  /**
   * Register an event listener.
   * @param {string} event - Event name ('ready', 'update', 'error', 'online', 'offline', 'settingsChanged', 'favoritesChanged', 'pluginLoaded', 'pluginUnloaded')
   * @param {Function} callback - Callback function
   * @returns {Weather} this
   */
  on(event, callback) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(callback);
    return this;
  },

  /**
   * Remove an event listener.
   * @param {string} event - Event name
   * @param {Function} callback - Callback to remove
   * @returns {Weather} this
   */
  off(event, callback) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(fn => fn !== callback);
    return this;
  },

  /**
   * Emit an event with data.
   * @param {string} event - Event name
   * @param {*} data - Data to pass
   * @private
   */
  _emit(event, data) {
    if (this._state.debug) console.debug(`[Weather] Event: ${event}`, data);
    if (!this._events[event]) return;
    this._events[event].forEach(fn => {
      try {
        fn(data);
      } catch (e) {
        console.warn(`[Weather] Error in event handler for "${event}":`, e);
      }
    });
  },

  // ─── Debug Mode ───
  /**
   * Enable or disable debug logging.
   * @param {boolean} enable
   */
  debug(enable) {
    this._state.debug = !!enable;
    this._config.debug = !!enable;
  },

  // ─── About ───
  /**
   * Returns library information.
   * @returns {Object} { version, features, credits }
   */
  about() {
    return {
      version: this.version,
      features: [
        'Current Weather', 'Forecast', 'Hourly', 'Weekly', 'Air Quality',
        'Weather Alerts', 'Reverse Geocoding', 'City Search',
        'AI Assistant', 'UI Components', 'Caching', 'Settings',
        'Favorites', 'Plugins', 'Ambient Sound', 'Themes',
      ],
      credits: 'Powered by Open-Meteo, Nominatim, and Web Audio API.',
    };
  },

  /**
   * Returns whether the library has completed initial loading.
   * @returns {boolean}
   */
  isReady() {
    return this._state.isReady;
  },

  // ─── Destroy ───
  /**
   * Clean up resources (intervals, sounds, animations, event listeners).
   */
  destroy() {
    // Clear refresh interval
    if (this._state.refreshInterval) {
      clearInterval(this._state.refreshInterval);
      this._state.refreshInterval = null;
    }
    // Stop ambient sound
    if (this._state.ambientRunning) this._stopAmbient();
    // Stop UI animations (if any)
    if (this.UI && this.UI.animation) {
      // We'll rely on the animation stop methods if they exist
      // but they are instance methods; we'll just clear any active ones.
      // For simplicity, we assume the user will handle their own animations.
    }
    // Remove all event listeners (optional)
    this._events = {};
    this._state.isReady = false;
    this._emit('destroy');
  },

  // ─── Configuration ───
  /**
   * Set library configuration.
   * @param {Object} settings - { theme, refresh, sound, animation, units, gps, debug }
   * @returns {Weather} this
   */
  config(settings) {
    Object.assign(this._config, settings);
    if (settings.debug !== undefined) this.debug(settings.debug);
    if (settings.theme) this.theme(settings.theme);
    if (settings.sound !== undefined) {
      if (settings.sound && !this._state.ambientRunning) this._startAmbient();
      if (!settings.sound && this._state.ambientRunning) this._stopAmbient();
    }
    if (settings.units && this._state.lastData) this._renderData(this._state.lastData);
    if (settings.refresh !== undefined) {
      if (this._state.refreshInterval) {
        clearInterval(this._state.refreshInterval);
        this._state.refreshInterval = null;
      }
      if (settings.refresh > 0) {
        this._state.refreshInterval = setInterval(
          () => this.refresh(),
          settings.refresh * 60000
        );
      }
    }
    // Also save to settings storage
    this.settings.set(settings);
    return this;
  },

  // ─── Theme ───
  /**
   * Set the theme.
   * @param {string} theme - 'light', 'dark', 'auto', 'glass', 'neon'
   * @returns {Weather} this
   */
  theme(theme) {
    const body = document.body;
    body.className = '';
    if (theme === 'auto') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(dark ? 'dark-theme' : 'light-theme');
    } else if (theme === 'glass') {
      body.classList.add('glass-theme');
    } else if (theme === 'neon') {
      body.classList.add('neon-theme');
    } else {
      body.classList.add(theme + '-theme');
    }
    // Also update UI theme object (if exists)
    if (this.UI && this.UI.theme) {
      this.UI.theme.set(theme);
    }
    this._config.theme = theme;
    localStorage.setItem('weather-theme', theme);
    return this;
  },

  // ─── City ───
  /**
   * Switch to a city by name.
   * @param {string} name - City name
   * @returns {Promise<Object>} City data
   */
  async city(name) {
    try {
      const result = await this.searchCity(name);
      if (result) {
        this._state.cityCoords = { lat: result.latitude, lon: result.longitude };
        await this.refresh();
        this.favorites.add(name);
        return result;
      }
    } catch (e) {
      console.warn('City not found:', e.message);
      throw e;
    }
  },

  // ─── Refresh ───
  /**
   * Force a refresh of weather data.
   * @returns {Promise<Object>} Latest data
   */
  async refresh() {
    try {
      await this._loadData(true); // force network
      this._emit('update', this._state.lastData);
      return this._state.lastData;
    } catch (e) {
      this._emit('error', e);
      throw e;
    }
  },

  // ─── AI Simplified ───
  /**
   * Ask the AI a question.
   * @param {string} question
   * @returns {Promise<string>} Answer
   */
  async ai(question) {
    if (!question) return 'Please ask a question.';
    try {
      return await this.AI.ask(question);
    } catch (e) {
      return 'Sorry, I had trouble answering that.';
    }
  },

  // ─── Render ───
  /**
   * Render a full weather widget inside a container.
   * @param {string|Element} selector
   * @returns {Weather} this
   */
  render(selector) {
    const container = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!container) {
      console.warn(`Container "${selector}" not found.`);
      return this;
    }
    // Inject default styles if not already present
    this._injectStyles();

    container.innerHTML = `
      <div class="weather-widget">
        <div class="ww-hero"></div>
        <div class="ww-hourly"></div>
        <div class="ww-weekly"></div>
        <div class="ww-air"></div>
        <div class="ww-alerts"></div>
      </div>
    `;
    this._state.widgetContainers = {
      hero: container.querySelector('.ww-hero'),
      hourly: container.querySelector('.ww-hourly'),
      weekly: container.querySelector('.ww-weekly'),
      air: container.querySelector('.ww-air'),
      alerts: container.querySelector('.ww-alerts'),
    };
    this.refresh();
    return this;
  },

  // ─── Init (multi‑widget) ───
  /**
   * Initialize multiple custom widgets.
   * @param {Object} config - { hero, current, forecast, hourly, air, alerts } (selectors or elements)
   * @returns {Weather} this
   */
  init(config) {
    this._state.widgetContainers = {};
    if (config.hero) this._state.widgetContainers.hero = config.hero;
    if (config.current) this._state.widgetContainers.current = config.current;
    if (config.forecast) this._state.widgetContainers.weekly = config.forecast;
    if (config.hourly) this._state.widgetContainers.hourly = config.hourly;
    if (config.air) this._state.widgetContainers.air = config.air;
    if (config.alerts) this._state.widgetContainers.alerts = config.alerts;
    this.refresh();
    return this;
  },

  // ─── Auto ───
  /**
   * Auto‑detect `data-weather` elements and render them.
   * @returns {Weather} this
   */
  auto() {
    document.querySelectorAll('[data-weather]').forEach(el => {
      const type = el.getAttribute('data-weather');
      this._state.widgetContainers[type] = el;
    });
    if (Object.keys(this._state.widgetContainers).length) this.refresh();
    return this;
  },

  // ─── Inject Default Styles ───
  _injectStyles() {
    if (document.getElementById('weather-styles')) return;
    const style = document.createElement('style');
    style.id = 'weather-styles';
    style.textContent = `
      /* Weather.js default widget styles */
      .weather-widget > div { margin-bottom: 12px; }
      .ww-hero { text-align: center; padding: 10px; }
      .ww-hero .ww-icon { font-size: 4rem; }
      .ww-hero .ww-temp { font-size: 2.8rem; font-weight: 300; }
      .ww-hero .ww-desc { font-size: 1.2rem; opacity: 0.8; }
      .ww-hero .ww-location { font-size: 0.9rem; opacity: 0.6; }
      .ww-hero .ww-meta { display: flex; justify-content: center; gap: 15px; font-size: 0.8rem; opacity: 0.7; margin-top: 10px; }
      .ww-hourly { display: flex; gap: 10px; overflow-x: auto; padding: 8px 0; }
      .ww-hourly .ww-hour-item { flex: 0 0 70px; text-align: center; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 12px; }
      .ww-hourly .ww-hour-item .ww-time { font-size: 0.7rem; opacity: 0.5; }
      .ww-hourly .ww-hour-item .ww-icon { font-size: 1.8rem; }
      .ww-hourly .ww-hour-item .ww-temp { font-weight: 600; }
      .ww-hourly .ww-hour-item .ww-rain { font-size: 0.6rem; opacity: 0.5; }
      .ww-weekly { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 10px; }
      .ww-weekly .ww-week-day { background: rgba(255,255,255,0.04); padding: 10px; border-radius: 14px; text-align: center; }
      .ww-weekly .ww-week-day .ww-day { font-weight: 600; font-size: 0.8rem; }
      .ww-weekly .ww-week-day .ww-date { font-size: 0.55rem; opacity: 0.4; text-transform: uppercase; }
      .ww-weekly .ww-week-day .ww-icon { font-size: 1.8rem; margin: 6px 0; }
      .ww-weekly .ww-week-day .ww-temps { font-size: 0.8rem; font-weight: 500; }
      .ww-weekly .ww-week-day .ww-rain { font-size: 0.65rem; opacity: 0.5; }
      .ww-air { display: flex; align-items: center; gap: 16px; }
      .ww-air .ww-aqi-circle { width: 64px; height: 64px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 1.4rem; }
      .ww-air .ww-aqi-circle .ww-aqi-label { font-size: 0.4rem; font-weight: 400; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
      .ww-air .ww-aqi-info .ww-aqi-label { font-weight: 500; }
      .ww-air .ww-aqi-info .ww-aqi-desc { font-size: 0.8rem; opacity: 0.6; }
      .ww-air .ww-aqi-details { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-top: 6px; }
      .ww-air .ww-aqi-details .ww-item { font-size: 0.7rem; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.04); padding: 2px 0; }
      .ww-air .ww-aqi-details .ww-item .ww-label { opacity: 0.5; }
      .ww-alerts .ww-alert-item { padding: 6px 10px; border-left: 3px solid #f1c40f; background: rgba(241,196,15,0.08); margin-bottom: 4px; border-radius: 6px; }
      .ww-alerts .ww-no-alerts { opacity: 0.6; }
      /* You can override these styles with your own */
    `;
    document.head.appendChild(style);
  },

  // ─── Internal Data Loader ───
  async _loadData(force = false) {
    try {
      // Check cache first
      if (!force) {
        const cached = this.cache.load();
        if (cached) {
          this._state.lastData = cached;
          this._renderData(cached);
          this._emit('update', cached);
          if (!this._state.isReady) {
            this._state.isReady = true;
            this._emit('ready', cached);
          }
          return cached;
        }
      }

      // Fetch fresh data
      let data;
      if (this._state.cityCoords) {
        const { lat, lon } = this._state.cityCoords;
        const [current, address, air, alerts] = await Promise.all([
          this.getCurrent({ latitude: lat, longitude: lon }),
          this.getAddress({ latitude: lat, longitude: lon }),
          this.getAirQuality({ latitude: lat, longitude: lon }),
          this.getAlerts(),
        ]);
        data = this._buildSummary(current, address, air, alerts);
      } else {
        data = await this.summary();
      }
      this._state.lastData = data;
      this.cache.save(data);
      this._renderData(data);
      this._emit('update', data);
      if (!this._state.isReady) {
        this._state.isReady = true;
        this._emit('ready', data);
      }
      return data;
    } catch (e) {
      this._emit('error', e);
      // Try to load from cache as fallback
      const cached = this.cache.load();
      if (cached) {
        this._state.lastData = cached;
        this._renderData(cached);
        this._emit('update', cached);
        return cached;
      }
      throw e;
    }
  },

  // ─── Build Summary from raw data ───
  _buildSummary(current, address, air, alerts) {
    const code = current.current.weather_code;
    return {
      location: {
        village: address.village,
        district: address.district,
        state: address.state,
        country: address.country,
        postcode: address.postcode,
        latitude: address.latitude,
        longitude: address.longitude,
        displayName: address.displayName,
      },
      weather: {
        icon: this.weatherIcon(code),
        condition: this.weatherCodeToText(code),
        temperature: current.current.temperature_2m,
        feelsLike: current.current.apparent_temperature,
        humidity: current.current.relative_humidity_2m,
        windSpeed: current.current.wind_speed_10m,
        rain: current.current.rain || 0,
        isDay: current.current.is_day === 1,
        time: current.current.time,
        timezone: current.timezone,
      },
      airQuality: {
        aqi: air.us_aqi,
        aqiDescription: this.getAQIDescription(air.us_aqi),
        pm25: air.pm2_5,
        pm10: air.pm10,
        carbonMonoxide: air.carbon_monoxide,
        nitrogenDioxide: air.nitrogen_dioxide,
        sulphurDioxide: air.sulphur_dioxide,
        ozone: air.ozone,
      },
      alerts: alerts,
      timestamp: new Date().toISOString(),
    };
  },

  // ─── Render Data into Widgets ───
  _renderData(data) {
    const w = data.weather;
    const loc = data.location;
    const aq = data.airQuality;
    const alerts = data.alerts;
    const containers = this._state.widgetContainers;

    // Helper to get element from selector or element
    const getEl = (ref) => {
      if (!ref) return null;
      return typeof ref === 'string' ? document.querySelector(ref) : ref;
    };

    // Hero
    const hero = getEl(containers.hero);
    if (hero) {
      hero.innerHTML = `
        <div class="ww-icon">${w.icon}</div>
        <div class="ww-temp">${Math.round(w.temperature)}°C</div>
        <div class="ww-desc">${w.condition}</div>
        <div class="ww-location">${loc.village || loc.district || loc.state || loc.country}</div>
        <div class="ww-meta">
          <span>💧 ${w.humidity}%</span>
          <span>🌬 ${Math.round(w.windSpeed)} km/h</span>
          <span>🌧 ${w.rain?.toFixed(1) || '0.0'} mm</span>
        </div>
      `;
    }

    // Current (simple)
    const current = getEl(containers.current);
    if (current) {
      current.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;">
          <span style="font-size:3rem;">${w.icon}</span>
          <div>
            <div style="font-size:1.8rem;font-weight:300;">${Math.round(w.temperature)}°C</div>
            <div style="opacity:0.7;">${w.condition}</div>
          </div>
        </div>
      `;
    }

    // Hourly
    const hourly = getEl(containers.hourly);
    if (hourly) {
      // Use cached or fresh hourly data
      this.getHourly().then(h => {
        if (h && h.hourly) {
          const hh = h.hourly;
          const now = new Date();
          const currentHour = now.getHours();
          let html = '<div class="ww-hourly">';
          for (let i = 0; i < Math.min(24, hh.time.length); i++) {
            const hour = new Date(hh.time[i]);
            const hourStr = hour.getHours().toString().padStart(2, '0') + ':00';
            const isNow = hour.getHours() === currentHour && hour.getDate() === now.getDate();
            const icon = this.weatherIcon(hh.weather_code[i]);
            const temp = Math.round(hh.temperature_2m[i]);
            const rain = hh.precipitation_probability[i] || 0;
            html += `
              <div class="ww-hour-item" style="${isNow ? 'border:1px solid #667eea;' : ''}">
                <div class="ww-time">${isNow ? 'Now' : hourStr}</div>
                <div class="ww-icon">${icon}</div>
                <div class="ww-temp">${temp}°</div>
                <div class="ww-rain">☔ ${Math.round(rain)}%</div>
              </div>
            `;
          }
          html += '</div>';
          hourly.innerHTML = html;
        }
      }).catch(() => {});
    }

    // Weekly
    const weekly = getEl(containers.weekly);
    if (weekly) {
      this.getWeeklySummary().then(week => {
        if (week && week.length) {
          let html = '<div class="ww-weekly">';
          week.slice(0, 7).forEach(day => {
            const date = new Date(day.date);
            const dayName = date.toLocaleDateString('en', { weekday: 'short' });
            const icon = this.weatherIcon(day.weatherCode);
            html += `
              <div class="ww-week-day">
                <div class="ww-day">${dayName}</div>
                <div class="ww-date">${date.toLocaleDateString('en', { month:'short', day:'numeric' })}</div>
                <div class="ww-icon">${icon}</div>
                <div class="ww-temps">${Math.round(day.maxTemp)}° / ${Math.round(day.minTemp)}°</div>
                <div class="ww-rain">☔ ${day.rainChance}%</div>
              </div>
            `;
          });
          html += '</div>';
          weekly.innerHTML = html;
        }
      }).catch(() => {});
    }

    // Air Quality
    const air = getEl(containers.air);
    if (air) {
      const aqiVal = aq.aqi ?? '--';
      const label = aq.aqiDescription || 'Loading...';
      const color = aqiVal <= 50 ? '#2ecc71' : aqiVal <= 100 ? '#f1c40f' : aqiVal <= 150 ? '#e67e22' : aqiVal <= 200 ? '#e74c3c' : '#8e44ad';
      air.innerHTML = `
        <div class="ww-air">
          <div class="ww-aqi-circle" style="background:${color};">
            ${aqiVal}
            <span class="ww-aqi-label">AQI</span>
          </div>
          <div class="ww-aqi-info">
            <div class="ww-aqi-label">${label}</div>
            <div class="ww-aqi-desc">PM2.5: ${aq.pm25 ?? '--'} · PM10: ${aq.pm10 ?? '--'}</div>
            <div class="ww-aqi-details">
              <div class="ww-item"><span class="ww-label">O₃</span> ${aq.ozone ?? '--'}</div>
              <div class="ww-item"><span class="ww-label">CO</span> ${aq.carbonMonoxide ?? '--'}</div>
              <div class="ww-item"><span class="ww-label">NO₂</span> ${aq.nitrogenDioxide ?? '--'}</div>
              <div class="ww-item"><span class="ww-label">SO₂</span> ${aq.sulphurDioxide ?? '--'}</div>
            </div>
          </div>
        </div>
      `;
    }

    // Alerts
    const alertsEl = getEl(containers.alerts);
    if (alertsEl) {
      if (alerts && alerts.length) {
        alertsEl.innerHTML = alerts.map(a =>
          `<div class="ww-alert-item">${a}</div>`
        ).join('');
      } else {
        alertsEl.innerHTML = '<div class="ww-no-alerts">✅ No alerts</div>';
      }
    }
  },

  // ─── CORE METHODS (Unified) ───

  /**
   * Get current GPS location.
   * @param {Object} [options] - { timeout }
   * @returns {Promise<{latitude, longitude}>}
   */
  async getLocation(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      const timeout = options.timeout || Constants.GEOLOCATION_TIMEOUT;
      const timer = setTimeout(() => {
        reject(new Error('Geolocation timeout'));
      }, timeout);
      navigator.geolocation.getCurrentPosition(
        pos => {
          clearTimeout(timer);
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  },

  /**
   * Get current weather. Optionally provide coordinates.
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Object>}
   */
  async getCurrent(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.API_BASE}/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,wind_speed_10m&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather API Error');
    return res.json();
  },

  /**
   * Get daily forecast. Optionally provide coordinates.
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Object>}
   */
  async getForecast(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.API_BASE}/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Forecast API Error');
    return res.json();
  },

  /**
   * Search for a city.
   * @param {string} city - City name
   * @returns {Promise<Object>} City data
   */
  async searchCity(city) {
    const url = `${Constants.GEOCODE_BASE}/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('City search failed');
    const data = await res.json();
    if (!data.results || data.results.length === 0) throw new Error('City not found');
    return data.results[0];
  },

  /**
   * Get current weather by city name.
   * @param {string} city
   * @returns {Promise<Object>}
   */
  async getCurrentByCity(city) {
    const place = await this.searchCity(city);
    return this.getCurrent({ latitude: place.latitude, longitude: place.longitude });
  },

  /**
   * Get address from coordinates.
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Object>} Address details
   */
  async getAddress(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.NOMINATIM_BASE}/reverse?lat=${loc.latitude}&lon=${loc.longitude}&format=jsonv2`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Address lookup failed');
    const data = await res.json();
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      village: data.address?.village || data.address?.hamlet || data.address?.town || data.address?.city || '',
      district: data.address?.county || data.address?.state_district || '',
      state: data.address?.state || '',
      country: data.address?.country || '',
      postcode: data.address?.postcode || '',
      displayName: data.display_name,
    };
  },

  /**
   * Get hourly forecast.
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Object>}
   */
  async getHourly(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.API_BASE}/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m&forecast_hours=24&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Hourly forecast failed');
    return res.json();
  },

  /**
   * Get weekly summary (7 days).
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Array>}
   */
  async getWeeklySummary(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.API_BASE}/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&forecast_days=7&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('7-day forecast failed');
    const data = await res.json();
    return data.daily.time.map((date, i) => ({
      date,
      weatherCode: data.daily.weather_code[i],
      maxTemp: data.daily.temperature_2m_max[i],
      minTemp: data.daily.temperature_2m_min[i],
      rainChance: data.daily.precipitation_probability_max[i],
      sunrise: data.daily.sunrise[i],
      sunset: data.daily.sunset[i],
    }));
  },

  /**
   * Get air quality data.
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Object>}
   */
  async getAirQuality(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.AQ_BASE}/air-quality?latitude=${loc.latitude}&longitude=${loc.longitude}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Air Quality API Error');
    const data = await res.json();
    return data.current;
  },

  /**
   * Get weather alerts.
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Array>}
   */
  async getAlerts(coords = null) {
    const loc = coords || await this.getLocation();
    const url = `${Constants.API_BASE}/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Alerts API Error');
      const data = await res.json();
      const alerts = [];
      const codes = data.daily?.weather_code || [];
      codes.forEach((code, i) => {
        if ([95, 96, 99].includes(code)) {
          const date = new Date(data.daily.time[i]);
          alerts.push(`⛈️ Thunderstorm expected on ${date.toLocaleDateString()}`);
        }
        if ([65, 82].includes(code)) {
          const date = new Date(data.daily.time[i]);
          alerts.push(`🌧️ Heavy rain expected on ${date.toLocaleDateString()}`);
        }
        if (data.daily.temperature_2m_min[i] < 0) {
          const date = new Date(data.daily.time[i]);
          alerts.push(`❄️ Freezing temperatures expected on ${date.toLocaleDateString()}`);
        }
        if (data.daily.temperature_2m_max[i] > 35) {
          const date = new Date(data.daily.time[i]);
          alerts.push(`🔥 Extreme heat expected on ${date.toLocaleDateString()}`);
        }
      });
      if (alerts.length === 0) alerts.push('✅ No weather alerts');
      return alerts;
    } catch (err) {
      return ['⚠️ Unable to fetch weather alerts'];
    }
  },

  /**
   * Get full weather summary (cached if fresh).
   * @param {Object} [coords] - { latitude, longitude }
   * @returns {Promise<Object>}
   */
  async summary(coords = null) {
    // If coords provided, force fresh fetch
    if (coords) {
      const [current, address, air, alerts] = await Promise.all([
        this.getCurrent(coords),
        this.getAddress(coords),
        this.getAirQuality(coords),
        this.getAlerts(coords),
      ]);
      const data = this._buildSummary(current, address, air, alerts);
      this.cache.save(data);
      return data;
    }
    // Otherwise use cache if fresh
    const cached = this.cache.load();
    if (cached && !this.cache.expired()) {
      return cached;
    }
    // Fetch fresh
    const loc = await this.getLocation();
    return this.summary(loc);
  },

  // ─── Helpers ───
  weatherCodeToText(code) {
    const codes = {
      0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
      45: 'Fog', 48: 'Depositing Fog', 51: 'Light Drizzle', 53: 'Moderate Drizzle',
      55: 'Heavy Drizzle', 56: 'Freezing Drizzle', 57: 'Dense Freezing Drizzle',
      61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain',
      67: 'Heavy Freezing Rain', 71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
      77: 'Snow Grains', 80: 'Light Rain Showers', 81: 'Rain Showers',
      82: 'Violent Rain Showers', 85: 'Light Snow Showers', 86: 'Heavy Snow Showers',
      95: 'Thunderstorm', 96: 'Thunderstorm With Hail', 99: 'Severe Thunderstorm',
    };
    return codes[code] || 'Unknown';
  },

  weatherIcon(code) {
    const icons = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️',
      61: '🌦️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
      71: '🌨️', 73: '❄️', 75: '❄️', 77: '❄️', 80: '🌦️', 81: '🌧️',
      82: '⛈️', 85: '🌨️', 86: '❄️', 95: '⛈️', 96: '⛈️', 99: '⛈️',
    };
    return icons[code] || '❓';
  },

  getAQIDescription(aqi) {
    if (aqi <= 50) return 'Good 🟢';
    if (aqi <= 100) return 'Moderate 🟡';
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups 🟠';
    if (aqi <= 200) return 'Unhealthy 🔴';
    if (aqi <= 300) return 'Very Unhealthy 🟣';
    return 'Hazardous 🟤';
  },

  // ─── STORAGE ───
  storage: {
    _prefix: Constants.STORAGE_PREFIX,
    set(key, value, expiry = null) {
      const data = { value, expiry: expiry ? Date.now() + expiry : null };
      try {
        localStorage.setItem(this._prefix + key, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    },
    get(key) {
      try {
        const raw = localStorage.getItem(this._prefix + key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.expiry && data.expiry < Date.now()) {
          localStorage.removeItem(this._prefix + key);
          return null;
        }
        return data.value;
      } catch (e) { return null; }
    },
    remove(key) {
      localStorage.removeItem(this._prefix + key);
    },
    clear() {
      Object.keys(localStorage)
        .filter(k => k.startsWith(this._prefix))
        .forEach(k => localStorage.removeItem(k));
    },
    keys() {
      return Object.keys(localStorage).filter(k => k.startsWith(this._prefix));
    },
  },

  // ─── SETTINGS ───
  settings: {
    _defaults: {
      units: 'metric',
      language: 'en',
      theme: Constants.DEFAULT_THEME,
      animation: true,
      sound: false,
      refresh: Constants.DEFAULT_REFRESH,
      gps: true,
    },
    set(values) {
      const merged = { ...this.get(), ...values };
      Weather.storage.set('settings', merged);
      Weather._emit('settingsChanged', merged);
      return merged;
    },
    get() {
      return Weather.storage.get('settings') || { ...this._defaults };
    },
    reset() {
      Weather.storage.remove('settings');
      const defs = { ...this._defaults };
      this.set(defs);
      return defs;
    },
  },

  // ─── CACHE ───
  cache: {
    _key: 'weather_cache',
    _ttl: Constants.CACHE_TTL,
    save(data) {
      const payload = { data, timestamp: Date.now(), version: Weather.version };
      Weather.storage.set(this._key, payload, this._ttl);
    },
    load() {
      const cached = Weather.storage.get(this._key);
      return cached?.data || null;
    },
    clear() {
      Weather.storage.remove(this._key);
    },
    expired() {
      const cached = Weather.storage.get(this._key);
      if (!cached) return true;
      return (Date.now() - cached.timestamp) > this._ttl;
    },
    size() {
      const raw = localStorage.getItem(Constants.STORAGE_PREFIX + this._key);
      return raw ? new Blob([raw]).size : 0;
    },
  },

  // ─── FAVORITES ───
  favorites: {
    _key: 'favorites',
    add(city) {
      const list = this.list();
      if (!list.includes(city)) {
        list.push(city);
        Weather.storage.set(this._key, list);
        Weather._emit('favoritesChanged', list);
      }
      return list;
    },
    remove(city) {
      let list = this.list();
      list = list.filter(c => c !== city);
      Weather.storage.set(this._key, list);
      Weather._emit('favoritesChanged', list);
      return list;
    },
    list() {
      return Weather.storage.get(this._key) || [];
    },
    clear() {
      Weather.storage.remove(this._key);
      Weather._emit('favoritesChanged', []);
    },
  },

  // ─── UTILITIES ───
  utils: {
    formatTemp(temp, unit = 'c') {
      if (unit === 'f') return Math.round(temp * 9/5 + 32) + '°F';
      return Math.round(temp) + '°C';
    },
    formatWind(speed, unit = 'metric') {
      if (unit === 'imperial') return Math.round(speed * 0.621371) + ' mph';
      return Math.round(speed) + ' km/h';
    },
    formatTime(iso, locale = 'en') {
      return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    },
    formatDate(iso, locale = 'en') {
      return new Date(iso).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
    },
    copy(text) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    },
    share(data) {
      if (navigator.share) {
        navigator.share(data).catch(() => {});
      } else {
        console.warn('Web Share API not supported');
      }
    },
  },

  // ─── NOTIFICATIONS ───
  notifications: {
    _permission: false,
    async requestPermission() {
      if (!('Notification' in window)) return false;
      const result = await Notification.requestPermission();
      this._permission = result === 'granted';
      return this._permission;
    },
    show(title, body, options = {}) {
      if (this._permission) {
        new Notification(title, { body, ...options });
      } else {
        Weather.UI.toast.show(`${title}: ${body}`, 4000, 'info');
      }
    },
    success(msg) {
      this.show('✅ Success', msg);
      Weather.UI.toast.success(msg);
    },
    warning(msg) {
      this.show('⚠️ Warning', msg);
      Weather.UI.toast.warning(msg);
    },
    error(msg) {
      this.show('❌ Error', msg);
      Weather.UI.toast.error(msg);
    },
    info(msg) {
      this.show('ℹ️ Info', msg);
      Weather.UI.toast.info(msg);
    },
  },

  // ─── PLUGINS ───
  _plugins: {},
  use(plugin) {
    if (!plugin.name) throw new Error('Plugin must have a name');
    if (this._plugins[plugin.name]) throw new Error(`Plugin "${plugin.name}" already registered`);
    this._plugins[plugin.name] = plugin;
    if (plugin.init) plugin.init(this);
    this._emit('pluginLoaded', plugin);
    return this;
  },
  plugin: {
    list() { return Object.keys(Weather._plugins); },
    remove(name) {
      const plugin = Weather._plugins[name];
      if (plugin && plugin.destroy) plugin.destroy(Weather);
      delete Weather._plugins[name];
      Weather._emit('pluginUnloaded', name);
    },
    get(name) { return Weather._plugins[name]; },
  },

  // ─── AMBIENT SOUND (Lazy, Optional) ───
  _startAmbient() {
    if (this._state.ambientRunning) return;
    if (!this._state.ambientCtx) {
      try {
        this._state.ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
        document.addEventListener('click', () => {
          if (this._state.ambientCtx && this._state.ambientCtx.state === 'suspended') {
            this._state.ambientCtx.resume();
            if (this._state.ambientRunning) this._ambientStartSound();
          }
        }, { once: true });
      } catch (e) {
        console.warn('Ambient sound not supported');
        return;
      }
    }
    if (this._state.ambientCtx.state === 'suspended') this._state.ambientCtx.resume();
    this._state.ambientRunning = true;
    this._ambientStartSound();
    if (this._state.ambientInterval) clearInterval(this._state.ambientInterval);
    this._state.ambientInterval = setInterval(() => this._ambientUpdateWeather(), 300000);
  },

  _stopAmbient() {
    this._state.ambientRunning = false;
    this._ambientStopSound();
    if (this._state.ambientInterval) {
      clearInterval(this._state.ambientInterval);
      this._state.ambientInterval = null;
    }
  },

  _ambientUpdateWeather() {
    this.getCurrent().then(data => {
      const code = data.current?.weather_code;
      if (code !== undefined && code !== this._state.ambientWeather) {
        this._state.ambientWeather = code;
        if (this._state.ambientRunning) {
          this._ambientStopSound();
          this._ambientStartSound();
        }
      }
    }).catch(() => {});
  },

  _ambientStartSound() {
    // Minimal implementation – the full ambient engine is in the UI module.
    // For brevity, we delegate to UI.sound or keep it simple.
    // In this version, we only start the UI.sound if available.
    if (this.UI && this.UI.sound) {
      // We could trigger weather-based sound here, but we'll let the UI handle it.
    }
  },

  _ambientStopSound() {
    // Stop UI.sound if playing
    if (this.UI && this.UI.sound) {
      this.UI.sound.stop();
    }
  },

  // ─── AI ASSISTANT (Full) ───
  AI: {
    async ask(question) {
      if (!question || question.trim() === '') return 'Please ask a question about the weather.';
      const intent = this.detectIntent(question);
      const context = await this.gatherContext(intent);
      return this.generateResponse(intent, context, question);
    },

    detectIntent(q) {
      const question = q.toLowerCase();
      if (question.includes('current') || question.includes('now') || question.includes('today') ||
        question.includes('temperature') || question.includes('hot') || question.includes('cold') ||
        (question.includes('weather') && !question.includes('forecast') && !question.includes('week')))
        return 'current';
      if (question.includes('rain') || question.includes('precipitation') || question.includes('umbrella')) return 'rain';
      if (question.includes('forecast') || question.includes('week') || question.includes('tomorrow') ||
        question.includes('next') || question.includes('future') || question.includes('days')) return 'forecast';
      if (question.includes('air') || question.includes('quality') || question.includes('pollution') ||
        question.includes('breath') || question.includes('aqi')) return 'air';
      if (question.includes('alert') || question.includes('warning') || question.includes('danger') ||
        question.includes('storm') || question.includes('severe')) return 'alerts';
      if (question.includes('where') || question.includes('location') || question.includes('address') ||
        question.includes('place')) return 'location';
      if (question.includes('wear') || question.includes('dress') || question.includes('clothes') ||
        question.includes('outside') || question.includes('walk') || question.includes('go out') ||
        question.includes('should i') || question.includes('can i') || question.includes('suitable')) return 'advice';
      return 'general';
    },

    async gatherContext(intent) {
      const ctx = {};
      try {
        const W = window.Weather;
        switch (intent) {
          case 'current':
          case 'rain':
          case 'advice':
          case 'general': {
            const summary = await W.summary();
            ctx.summary = summary;
            ctx.current = summary.weather;
            ctx.location = summary.location;
            break;
          }
          case 'forecast': {
            ctx.weekly = await W.getWeeklySummary();
            ctx.current = await W.getCurrent();
            break;
          }
          case 'air': {
            ctx.airQuality = await W.getAirQuality();
            ctx.aqiDescription = W.getAQIDescription;
            break;
          }
          case 'alerts': {
            ctx.alerts = await W.getAlerts();
            break;
          }
          case 'location': {
            ctx.address = await W.getAddress();
            break;
          }
        }
      } catch (err) { ctx.error = err.message; }
      return ctx;
    },

    generateResponse(intent, context, question) {
      try {
        switch (intent) {
          case 'current': return this.respondCurrent(context);
          case 'rain': return this.respondRain(context);
          case 'forecast': return this.respondForecast(context);
          case 'air': return this.respondAirQuality(context);
          case 'alerts': return this.respondAlerts(context);
          case 'location': return this.respondLocation(context);
          case 'advice': return this.respondAdvice(context);
          default: return this.respondGeneral(context, question);
        }
      } catch (err) { return "I'm having trouble answering that right now. Please try again."; }
    },

    respondCurrent(context) {
      if (!context.current) return 'Unable to get current weather.';
      const w = context.current;
      const loc = context.location;
      return `${w.icon} Currently in ${loc.village || 'your location'}:\n🌡 ${w.temperature}°C (feels like ${w.feelsLike}°C)\n💧 ${w.humidity}% humidity\n🌬 ${w.windSpeed} km/h wind\n${w.isDay ? '☀️ Daytime' : '🌙 Nighttime'}`;
    },
    respondRain(context) {
      if (!context.current) return 'Unable to check rain forecast.';
      const w = context.current;
      const rain = w.rain || 0;
      if (rain > 0) return `🌧️ Rain is expected today (${rain} mm).\n☔ Don't forget to carry an umbrella!`;
      return `☀️ No rain expected today.\nEnjoy the ${w.condition.toLowerCase()} weather!`;
    },
    respondForecast(context) {
      if (!context.weekly) return 'Unable to get forecast.';
      const week = context.weekly;
      let response = '📅 7-Day Forecast:\n\n';
      week.slice(0, 5).forEach(day => {
        const date = new Date(day.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const icon = Weather.weatherIcon(day.weatherCode);
        response += `${dayName}: ${icon} ${Math.round(day.maxTemp)}°/${Math.round(day.minTemp)}° ☔ ${day.rainChance}%\n`;
      });
      return response;
    },
    respondAirQuality(context) {
      if (!context.airQuality) return 'Unable to get air quality data.';
      const aq = context.airQuality;
      const desc = Weather.getAQIDescription(aq.us_aqi);
      return `🌬 Air Quality Index: ${aq.us_aqi} - ${desc}\nPM2.5: ${aq.pm2_5} μg/m³\nPM10: ${aq.pm10} μg/m³\nOzone: ${aq.ozone} μg/m³\n${aq.us_aqi <= 100 ? '✅ Air quality is acceptable.' : '⚠️ Sensitive groups should limit outdoor activity.'}`;
    },
    respondAlerts(context) {
      if (!context.alerts) return 'Unable to check weather alerts.';
      const alerts = context.alerts;
      if (alerts.length === 0) return 'No weather alerts found.';
      return `⚠️ Weather Alerts:\n\n${alerts.join('\n')}`;
    },
    respondLocation(context) {
      if (!context.address) return 'Unable to get location.';
      const addr = context.address;
      return `📍 Your location:\n${addr.village || ''}\n${addr.district || ''}\n${addr.state || ''}, ${addr.country || ''}\nPostcode: ${addr.postcode || 'N/A'}`;
    },
    respondAdvice(context) {
      if (!context.current) return 'Unable to give advice.';
      const w = context.current;
      let advice = [];
      if (w.temperature > 30) {
        advice.push("🔥 It's hot outside. Wear light, breathable clothing.");
        advice.push('💧 Stay hydrated and use sunscreen.');
      } else if (w.temperature < 15) {
        advice.push("❄️ It's cool. Wear warm layers and a jacket.");
      } else {
        advice.push('👕 Comfortable clothing is suitable for this weather.');
      }
      if (w.rain > 0) advice.push('☔ Rain is expected. Carry an umbrella.');
      if (w.windSpeed > 30) advice.push('🌬 It\'s windy. Secure loose items and dress accordingly.');
      if (context.summary && context.summary.airQuality.aqi > 100) advice.push('😷 Air quality is moderate to poor. Consider limiting outdoor activities.');
      if (context.summary && context.summary.alerts.length > 0 && !context.summary.alerts[0].includes('No weather alerts')) advice.push(`⚠️ Active weather alerts: ${context.summary.alerts.join(', ')}`);
      return `💡 Advice:\n\n${advice.join('\n')}`;
    },
    respondGeneral(context, question) {
      if (context.summary) {
        const w = context.summary.weather;
        const loc = context.summary.location;
        return `${w.icon} ${w.condition} in ${loc.village || 'your location'}\n🌡 ${w.temperature}°C (feels like ${w.feelsLike}°C)\n💧 ${w.humidity}% humidity\n🌬 ${w.windSpeed} km/h\n\nI can tell you more about the forecast, air quality, or give advice. Try asking "Will it rain?" or "What should I wear?"`;
      }
      return 'I can help you with weather questions. Try asking about current weather, forecast, rain, or what to wear!';
    },

    async suggest() {
      const summary = await Weather.summary();
      const w = summary.weather;
      const loc = summary.location;
      let suggestions = [];
      if (w.rain === 0 && w.temperature > 20 && w.temperature < 30) {
        suggestions.push(`🚶 Great weather for a walk in ${loc.village || 'your area'}.`);
        suggestions.push('🌳 Perfect day for outdoor activities.');
      } else if (w.rain > 0) {
        suggestions.push('☔ Rain expected - good day for indoor activities.');
        suggestions.push('🎬 Perfect for watching a movie or reading a book.');
      } else if (w.temperature > 30) {
        suggestions.push('🏊 Consider going for a swim or visiting an air-conditioned place.');
        suggestions.push('🍦 Grab some ice cream to cool down!');
      } else if (w.temperature < 15) {
        suggestions.push('☕ Enjoy a hot drink and stay warm indoors.');
        suggestions.push('🔥 Perfect day for a cozy indoor activity.');
      }
      if (summary.airQuality.aqi > 100) suggestions.push(`😷 Air quality is ${summary.airQuality.aqiDescription.toLowerCase()}. Consider staying indoors if sensitive.`);
      return `💡 Suggestions for today:\n\n${suggestions.join('\n')}`;
    },

    async explain(concept) {
      const explanations = {
        temperature: '🌡 Temperature measures how hot or cold the air is. It affects how we feel and what we wear.',
        humidity: '💧 Humidity is the amount of water vapor in the air. High humidity makes it feel hotter than it actually is.',
        wind: '🌬 Wind is the movement of air. It can make temperatures feel colder (wind chill) or drier.',
        rain: '☔ Rain is liquid water falling from clouds. It\'s measured in millimeters (mm).',
        aqi: '🌬 AQI (Air Quality Index) measures air pollution levels. Higher numbers mean worse air quality.',
        precipitation: '🌧️ Precipitation is any water falling from the sky - rain, snow, or hail.',
        forecast: '📅 A forecast predicts future weather conditions using computer models and historical data.',
      };
      const key = Object.keys(explanations).find(k => concept.toLowerCase().includes(k));
      return key ? explanations[key] : `I don't have an explanation for "${concept}" yet. Try asking about temperature, humidity, wind, rain, AQI, or forecast.`;
    },

    async tips() {
      const summary = await Weather.summary();
      const w = summary.weather;
      const aq = summary.airQuality;
      let tips = [];
      if (w.temperature > 30) {
        tips.push('☀️ Apply sunscreen and wear a hat.');
        tips.push('💧 Drink plenty of water throughout the day.');
        tips.push('🕶️ Wear sunglasses to protect your eyes.');
      }
      if (w.temperature < 10) {
        tips.push('🧣 Bundle up with warm clothing.');
        tips.push('🧤 Wear gloves and a warm hat.');
        tips.push('☕ Stay warm with hot beverages.');
      }
      if (w.rain > 0) {
        tips.push('☔ Keep an umbrella handy.');
        tips.push('🧥 Wear waterproof clothing.');
        tips.push('🚗 Drive carefully - roads may be slippery.');
      }
      if (w.windSpeed > 25) {
        tips.push('🌬 Secure outdoor items that could blow away.');
        tips.push('🧥 Wear wind-resistant clothing.');
      }
      if (aq.aqi > 100) {
        tips.push('😷 Consider wearing a mask if going outside.');
        tips.push('🏠 Keep windows closed to reduce indoor pollution.');
        tips.push('🌿 Use an air purifier indoors if available.');
      }
      if (summary.alerts && !summary.alerts[0].includes('No weather alerts')) tips.push(`⚠️ Be aware of weather alerts: ${summary.alerts.join(', ')}`);
      tips.push('📱 Check the forecast regularly for updates.');
      return `🌤️ Weather Tips:\n\n${tips.join('\n')}`;
    },
  },

  // ─── UI MODULE ───
  UI: {
    // ─── Theme (now only used internally; public API is Weather.theme) ───
    theme: {
      set(theme) {
        document.documentElement.setAttribute('data-theme', theme);
      },
      get() {
        return document.documentElement.getAttribute('data-theme') || 'light';
      },
      toggle() {
        const current = this.get();
        const next = current === 'dark' ? 'light' : 'dark';
        this.set(next);
        return next;
      },
    },

    // ─── Background ───
    background: {
      set(color) {
        document.body.style.background = color;
        return color;
      },
      auto() {
        const theme = Weather.UI.theme.get();
        const colors = {
          light: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          dark: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        };
        document.body.style.background = colors[theme] || colors.light;
        return colors[theme];
      },
      weather(condition) {
        const bgs = {
          'Clear Sky': 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
          'Mainly Clear': 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
          'Partly Cloudy': 'linear-gradient(135deg, #bdc3c7 0%, #2c3e50 100%)',
          'Overcast': 'linear-gradient(135deg, #61677a 0%, #2d3436 100%)',
          'Fog': 'linear-gradient(135deg, #9b59b6 0%, #bdc3c7 100%)',
          'Rain': 'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
          'Light Rain': 'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
          'Heavy Rain': 'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)',
          'Snow': 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
          'Light Snow': 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
          'Thunderstorm': 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          'Clear': 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
        };
        const bg = bgs[condition] || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        document.body.style.background = bg;
        return bg;
      },
    },

    // ─── Animation ───
    animation: {
      rain() {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        const drops = [];
        for (let i = 0; i < 100; i++) {
          drops.push({
            x: Math.random() * width,
            y: Math.random() * height,
            length: Math.random() * 20 + 10,
            speed: Math.random() * 5 + 5,
            opacity: Math.random() * 0.3 + 0.2,
          });
        }
        let id;
        const draw = () => {
          ctx.clearRect(0, 0, width, height);
          ctx.strokeStyle = '#7ec8e3';
          ctx.lineWidth = 1;
          drops.forEach(d => {
            ctx.globalAlpha = d.opacity;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x, d.y + d.length);
            ctx.stroke();
            d.y += d.speed;
            if (d.y > height) {
              d.y = -d.length;
              d.x = Math.random() * width;
            }
          });
          id = requestAnimationFrame(draw);
        };
        draw();
        return {
          stop() {
            cancelAnimationFrame(id);
            canvas.remove();
          },
        };
      },

      snow() {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        const flakes = [];
        for (let i = 0; i < 150; i++) {
          flakes.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 4 + 2,
            speed: Math.random() * 1 + 0.5,
            wind: Math.random() * 0.5 - 0.25,
            opacity: Math.random() * 0.5 + 0.3,
          });
        }
        let id;
        const draw = () => {
          ctx.clearRect(0, 0, width, height);
          flakes.forEach(f => {
            ctx.globalAlpha = f.opacity;
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
            ctx.fill();
            f.y += f.speed;
            f.x += f.wind;
            if (f.y > height) {
              f.y = -f.radius;
              f.x = Math.random() * width;
            }
            if (f.x > width) f.x = 0;
            if (f.x < 0) f.x = width;
          });
          id = requestAnimationFrame(draw);
        };
        draw();
        return {
          stop() {
            cancelAnimationFrame(id);
            canvas.remove();
          },
        };
      },

      thunder() {
        const flash = document.createElement('div');
        flash.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:white;pointer-events:none;z-index:9998;opacity:0;';
        document.body.appendChild(flash);
        let count = 0;
        const interval = setInterval(() => {
          if (count > 3) {
            clearInterval(interval);
            flash.remove();
            return;
          }
          flash.style.opacity = Math.random() > 0.5 ? '0.8' : '0';
          setTimeout(() => { flash.style.opacity = '0'; }, 100);
          count++;
        }, 500);
        return {
          stop() {
            clearInterval(interval);
            flash.remove();
          },
        };
      },

      fadeIn(el, d = 500) {
        el.style.opacity = '0';
        el.style.transition = `opacity ${d}ms ease`;
        setTimeout(() => { el.style.opacity = '1'; }, 10);
        return el;
      },

      slideUp(el, d = 300) {
        el.style.transform = 'translateY(20px)';
        el.style.opacity = '0';
        el.style.transition = `all ${d}ms ease`;
        setTimeout(() => {
          el.style.transform = 'translateY(0)';
          el.style.opacity = '1';
        }, 10);
        return el;
      },
    },

    // ─── Widget (re‑uses the new class‑based rendering) ───
    widget: {
      current(containerId) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        // Use the internal renderer
        Weather._state.widgetContainers.current = container;
        Weather._renderData(Weather._state.lastData || {});
        return container;
      },
      forecast(containerId, days = 3) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        Weather._state.widgetContainers.weekly = container;
        Weather._renderData(Weather._state.lastData || {});
        return container;
      },
      airQuality(containerId) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        Weather._state.widgetContainers.air = container;
        Weather._renderData(Weather._state.lastData || {});
        return container;
      },
      hourly(containerId, hours = 12) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        Weather._state.widgetContainers.hourly = container;
        Weather._renderData(Weather._state.lastData || {});
        return container;
      },
    },

    // ─── Card, Chart, Effect, Sound, Loading, Popup, Toast, Progress ───
    // (These remain identical to previous versions but with class-based styles)
    card: {
      create(title, content, className = '') {
        const card = document.createElement('div');
        card.className = `weather-card ${className}`;
        card.innerHTML = `<h3>${title}</h3><div>${content}</div>`;
        return card;
      },
      weather(data) {
        const w = data.weather || data;
        return `
          <div style="text-align:center;">
            <div style="font-size:4rem;">${w.icon || '☀️'}</div>
            <div style="font-size:2.5rem;font-weight:bold;">${w.temperature || '--'}°C</div>
            <div style="font-size:1.1rem;opacity:0.9;">${w.condition || 'Unknown'}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:15px;opacity:0.8;">
              <div>💧 ${w.humidity || '--'}%</div>
              <div>🌬 ${w.windSpeed || '--'} km/h</div>
              <div>🌧 ${w.rain || '--'} mm</div>
            </div>
          </div>
        `;
      },
      forecast(day) {
        const icon = Weather.weatherIcon(day.weatherCode);
        const date = new Date(day.date);
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
            <div style="min-width:100px;font-weight:bold;">${date.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'})}</div>
            <div style="font-size:1.8rem;">${icon}</div>
            <div style="min-width:80px;text-align:right;">${Math.round(day.maxTemp)}° / ${Math.round(day.minTemp)}°</div>
            <div style="min-width:60px;text-align:right;opacity:0.7;">☔ ${day.rainChance}%</div>
          </div>
        `;
      },
    },

    chart: {
      temperature(containerId, days = 7) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        Weather.getWeeklySummary().then(week => {
          const data = week.slice(0, days);
          const max = Math.max(...data.map(d => d.maxTemp));
          const min = Math.min(...data.map(d => d.minTemp));
          const range = max - min || 1;
          let html = '<div style="display:flex;align-items:flex-end;height:180px;gap:12px;padding:0 5px;">';
          data.forEach(day => {
            const height = ((day.maxTemp - min) / range) * 150 + 20;
            const label = new Date(day.date).toLocaleDateString('en', { weekday: 'short' });
            html += `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;position:relative;">
                <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;">
                  <div style="width:80%;background:#e17055;border-radius:4px 4px 0 0;height:${height}px;transition:height 0.5s;min-height:5px;"></div>
                  <div style="width:80%;background:#74b9ff;border-radius:0 0 4px 4px;height:${Math.max(0, ((day.minTemp - min) / range) * 150 + 20)}px;transition:height 0.5s;min-height:3px;"></div>
                </div>
                <div style="font-size:0.65rem;margin-top:5px;">${label}</div>
                <div style="font-size:0.6rem;opacity:0.7;">${Math.round(day.maxTemp)}°</div>
              </div>
            `;
          });
          html += '</div>';
          container.innerHTML = html;
        }).catch(() => {});
      },

      rain(containerId, days = 7) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        Weather.getWeeklySummary().then(week => {
          const data = week.slice(0, days);
          let html = '<div style="display:flex;align-items:flex-end;height:150px;gap:12px;padding:0 5px;">';
          data.forEach(day => {
            const height = day.rainChance * 1.4;
            const label = new Date(day.date).toLocaleDateString('en', { weekday: 'short' });
            const color = day.rainChance > 70 ? '#e17055' : day.rainChance > 40 ? '#fdcb6e' : '#74b9ff';
            html += `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;">
                <div style="width:80%;background:${color};border-radius:4px 4px 0 0;height:${height}px;transition:height 0.5s;min-height:5px;"></div>
                <div style="font-size:0.65rem;margin-top:5px;">${label}</div>
                <div style="font-size:0.6rem;opacity:0.7;">${day.rainChance}%</div>
              </div>
            `;
          });
          html += '</div>';
          container.innerHTML = html;
        }).catch(() => {});
      },
    },

    effect: {
      glow(selector) {
        const els = document.querySelectorAll(selector);
        els.forEach(el => el.style.boxShadow = '0 0 20px rgba(102,126,234,0.4)');
        return els;
      },
      pulse(selector) {
        const els = document.querySelectorAll(selector);
        els.forEach(el => {
          el.style.animation = 'weatherPulse 2s infinite';
        });
        if (!document.getElementById('weather-pulse-style')) {
          const style = document.createElement('style');
          style.id = 'weather-pulse-style';
          style.textContent = '@keyframes weatherPulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.05)}}';
          document.head.appendChild(style);
        }
        return els;
      },
      shimmer(selector) {
        const els = document.querySelectorAll(selector);
        els.forEach(el => {
          el.style.position = 'relative';
          el.style.overflow = 'hidden';
          const shim = document.createElement('div');
          shim.style.cssText = 'position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent);animation:weatherShimmer 2s infinite;';
          el.appendChild(shim);
        });
        if (!document.getElementById('weather-shimmer-style')) {
          const style = document.createElement('style');
          style.id = 'weather-shimmer-style';
          style.textContent = '@keyframes weatherShimmer {0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}';
          document.head.appendChild(style);
        }
        return els;
      },
    },

    sound: {
      // Using the Web Audio API synthesised sounds (same as before)
      _ctx: null,
      _activeSources: [],
      _getContext() {
        if (!this._ctx) this._ctx = new(window.AudioContext || window.webkitAudioContext)();
        if (this._ctx.state === 'suspended') this._ctx.resume();
        return this._ctx;
      },
      _stopAll() {
        this._activeSources.forEach(src => { try { src.stop(); } catch (e) {} });
        this._activeSources = [];
      },
      async rain() {
        try {
          this._stopAll();
          const ctx = this._getContext();
          const bufferSize = ctx.sampleRate * 0.5;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.value = 0.2;
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 1000;
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start();
          noise.stop(ctx.currentTime + 0.5);
          this._activeSources.push(noise);
          return { success: true, message: '🌧️ Rain (synthesized)' };
        } catch (err) { return { success: false, message: err.message }; }
      },
      async thunder() {
        try {
          this._stopAll();
          const ctx = this._getContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(80, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.8);
          gain.gain.setValueAtTime(0.4, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.8);
          this._activeSources.push(osc);
          return { success: true, message: '⚡ Thunder (synthesized)' };
        } catch (err) { return { success: false, message: err.message }; }
      },
      async notification() {
        try {
          this._stopAll();
          const ctx = this._getContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
          this._activeSources.push(osc);
          return { success: true, message: '🔔 Notification (synthesized)' };
        } catch (err) { return { success: false, message: err.message }; }
      },
      async fromWeather(code) {
        if ([95, 96, 99].includes(code)) return this.thunder();
        if ([61, 63, 65, 80, 81, 82].includes(code)) return this.rain();
        return this.notification();
      },
      stop() {
        this._stopAll();
        return { success: true, message: '⏹️ All sounds stopped' };
      },
      async requestPermission() {
        try {
          const ctx = this._getContext();
          if (ctx.state === 'running') return { granted: true, message: 'Audio ready' };
          await ctx.resume();
          return { granted: true, message: 'Audio resumed' };
        } catch (err) { return { granted: false, message: err.message }; }
      },
      isAudioAllowed() {
        return this._ctx && this._ctx.state === 'running';
      },
    },

    loading: {
      show(containerId, text = 'Loading...') {
        const container = containerId ? document.getElementById(containerId) : document.body;
        if (!container) { console.error('Container not found'); return; }
        const overlay = document.createElement('div');
        overlay.className = 'weather-loading';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;flex-direction:column;z-index:10000;color:white;backdrop-filter:blur(5px);';
        overlay.innerHTML = `<div style="font-size:3rem;animation:weatherSpin 1s linear infinite;">⏳</div><div style="margin-top:15px;font-size:1.1rem;">${text}</div>`;
        if (!document.getElementById('weather-loading-style')) {
          const s = document.createElement('style');
          s.id = 'weather-loading-style';
          s.textContent = '@keyframes weatherSpin {0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}';
          document.head.appendChild(s);
        }
        document.body.appendChild(overlay);
        return overlay;
      },
      hide() {
        const overlay = document.querySelector('.weather-loading');
        if (overlay) { overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.3s';
          setTimeout(() => overlay.remove(), 300); }
        return true;
      },
      progress(containerId, value, max = 100, text = 'Loading...') {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        const percent = Math.min((value / max) * 100, 100);
        container.innerHTML = `
          <div style="padding:15px;border-radius:10px;background:rgba(255,255,255,0.05);">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
              <span>${text}</span>
              <span>${Math.round(percent)}%</span>
            </div>
            <div style="width:100%;background:rgba(255,255,255,0.2);border-radius:10px;overflow:hidden;height:8px;">
              <div style="width:${percent}%;background:linear-gradient(90deg,#667eea,#764ba2);height:100%;border-radius:10px;transition:width 0.5s;"></div>
            </div>
          </div>
        `;
        return container;
      },
    },

    popup: {
      show(title, message, type = 'info') {
        const popup = document.createElement('div');
        popup.className = 'weather-popup';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.95);border-radius:16px;padding:30px;min-width:300px;max-width:500px;z-index:10001;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:weatherPopupIn 0.3s ease;';
        const colors = { info: '#3498db', warning: '#f39c12', error: '#e74c3c', success: '#2ecc71' };
        const icons = { info: 'ℹ️', warning: '⚠️', error: '❌', success: '✅' };
        popup.innerHTML = `
          <div style="font-size:2rem;text-align:center;">${icons[type]}</div>
          <h3 style="margin:10px 0 10px 0;color:${colors[type]};text-align:center;">${title}</h3>
          <p style="text-align:center;color:#2d3436;">${message}</p>
          <button onclick="this.closest('.weather-popup').remove()" style="display:block;margin:15px auto 0;padding:10px 30px;background:#667eea;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;">Close</button>
        `;
        if (!document.getElementById('weather-popup-style')) {
          const s = document.createElement('style');
          s.id = 'weather-popup-style';
          s.textContent = '@keyframes weatherPopupIn {from{opacity:0;transform:translate(-50%,-50%) scale(0.8)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}';
          document.head.appendChild(s);
        }
        document.body.appendChild(popup);
        return popup;
      },
      close() {
        const p = document.querySelector('.weather-popup');
        if (p) { p.style.opacity = '0';
          p.style.transition = 'opacity 0.3s';
          setTimeout(() => p.remove(), 300); }
        return true;
      },
    },

    toast: {
      show(message, duration = 3000, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'weather-toast';
        const colors = { info: '#667eea', success: '#00b894', warning: '#fdcb6e', error: '#e17055' };
        toast.style.cssText = `
          position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
          background: ${colors[type] || colors.info};
          color: ${type === 'warning' ? '#2d3436' : 'white'};
          padding: 12px 24px; border-radius: 8px; z-index: 10002;
          animation: weatherToastIn 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          font-weight: ${type === 'warning' ? 'bold' : 'normal'};
          max-width: 90%; text-align: center;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transition = 'opacity 0.3s';
          setTimeout(() => toast.remove(), 300);
        }, duration);
        if (!document.getElementById('weather-toast-style')) {
          const s = document.createElement('style');
          s.id = 'weather-toast-style';
          s.textContent = '@keyframes weatherToastIn {from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
          document.head.appendChild(s);
        }
        return toast;
      },
      success(msg, d) { return this.show(msg, d, 'success'); },
      warning(msg, d) { return this.show(msg, d, 'warning'); },
      error(msg, d) { return this.show(msg, d, 'error'); },
      info(msg, d) { return this.show(msg, d, 'info'); },
    },

    progress: {
      show(containerId, value, max = 100, label = 'Progress') {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        const percent = Math.min((value / max) * 100, 100);
        container.innerHTML = `
          <div style="padding:15px;border-radius:10px;background:rgba(255,255,255,0.05);">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
              <span>${label}</span>
              <span>${Math.round(percent)}%</span>
            </div>
            <div style="width:100%;background:rgba(255,255,255,0.2);border-radius:10px;overflow:hidden;height:10px;">
              <div class="weather-progress-bar" style="width:${percent}%;background:linear-gradient(90deg,#667eea,#764ba2);height:100%;border-radius:10px;transition:width 0.5s;"></div>
            </div>
          </div>
        `;
        return container;
      },
      update(containerId, value, max = 100) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('Container not found'); return; }
        const percent = Math.min((value / max) * 100, 100);
        const bar = container.querySelector('.weather-progress-bar');
        const label = container.querySelector('div > div > span:last-child');
        if (bar) bar.style.width = percent + '%';
        if (label) label.textContent = Math.round(percent) + '%';
        return container;
      },
      hide(containerId) {
        const container = document.getElementById(containerId);
        if (container) container.innerHTML = '';
        return true;
      },
    },
  },

  // ─── Initialisation ───
  _init() {
    // Load settings and apply
    const settings = this.settings.get();
    this.settings.set(settings);

    // Apply theme from settings
    if (settings.theme) this.theme(settings.theme);

    // Online/offline events
    window.addEventListener('online', () => {
      this._state.isOnline = true;
      this._emit('online');
      this.refresh();
    });
    window.addEventListener('offline', () => {
      this._state.isOnline = false;
      this._emit('offline');
    });

    // Try to load cached data
    if (!this.cache.expired()) {
      const cached = this.cache.load();
      if (cached) {
        this._state.lastData = cached;
        this._renderData(cached);
        this._emit('ready', cached);
        this._emit('update', cached);
        this._state.isReady = true;
      }
    }

    // Auto-refresh
    const refreshInterval = settings.refresh || Constants.DEFAULT_REFRESH;
    if (refreshInterval > 0) {
      if (this._state.refreshInterval) clearInterval(this._state.refreshInterval);
      this._state.refreshInterval = setInterval(
        () => this.refresh(),
        refreshInterval * 60000
      );
    }

    // Start ambient sound if enabled
    if (settings.sound) {
      this._startAmbient();
    }

    this._emit('init');
  },
};

// ─── Auto‑initialise ───
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Weather._init());
} else {
  Weather._init();
}

// ─── Expose globally ───
window.Weather = Weather;
