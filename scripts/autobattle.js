/**
 * Bulletproof Autobattle helper for Encoreable.
 * - Suppresses all modal popups (ProxyPopup, News PM, transient handshake alerts).
 * - Automatically initializes usernames without remote auth.
 * - Injects legal Champions VGC teams into teambuilder and active slot.
 * - Automatically issues and accepts challenges to start battle immediately.
 */

window.POKEMON_SHOWDOWN_TESTCLIENT_KEY = 'local';

(function () {
  // 1. Inject global CSS to suppress unwanted popup overlays and news widgets
  const style = document.createElement('style');
  style.id = 'encoreable-autobattle-styles';
  style.textContent = `
    .news-embed,
    .pm-window.news-embed,
    #overlay_iframe,
    .modal-dialog,
    .ps-popup form p a[href*="wikipedia.org"],
    .ps-popup form iframe {
      display: none !important;
    }
  `;
  if (document.head) {
    document.head.appendChild(style);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  }

  // 2. Intercept jQuery AJAX calls to completely bypass remote loginserver checks
  function hookJQuery() {
    if (window.$ && $.post) {
      const origPost = $.post;
      $.post = function (url, data, callback, type) {
        if (typeof data === 'object' && (data.act === 'upkeep' || data.act === 'getassertion' || data.act === 'login')) {
          if (typeof callback === 'function') {
            callback('{"username":""}');
          }
          return;
        }
        return origPost.apply(this, arguments);
      };

      const origGet = $.get;
      $.get = function (url, data, callback, type) {
        if (typeof data === 'object' && (data.act === 'getteams' || data.act === 'upkeep')) {
          if (typeof callback === 'function') {
            callback('{"teams":[]}');
          }
          return;
        }
        return origGet.apply(this, arguments);
      };
    } else {
      setTimeout(hookJQuery, 50);
    }
  }
  hookJQuery();

  const params = new URLSearchParams(window.location.search);
  const autoName = params.get('autoname');
  const autoTeam = params.get('autoteam');
  const autoChallenge = params.get('autochallenge');
  const autoAccept = params.get('autoaccept');
  const format = params.get('format') || 'gen9championsvgc2026regmb';

  if (!autoName && !autoTeam && !autoChallenge && !autoAccept) {
    return; // Normal manual mode
  }

  console.log('[Encoreable Autobattle] Started for:', { autoName, autoTeam, autoChallenge, autoAccept });

  // Standard legal teams for Champions VGC 2026 Reg M-B
  const P1_PACKED = 'Gardevoir||Gardevoirite|Synchronize|Moonblast,Psychic,Thunderbolt,Protect|Modest|2,,,32,,32||||50|,,,,,Fairy]Klefki||LightClay|Prankster|Sandstorm,ThunderWave,Reflect,Protect|Calm|2,,,32,,32||||50|,,,,,Steel]Tyranitar||LumBerry|SandStream|RockSlide,Crunch,LowKick,Protect|Adamant|2,,,32,,32||||50|,,,,,Rock]Excadrill||FocusSash|SandRush|HighHorsepower,IronHead,RockSlide,Protect|Jolly|2,,,32,,32||||50|,,,,,Ground]Sinistcha||Leftovers|Hospitality|MatchaGotcha,StrengthSap,RagePowder,TrickRoom|Calm|2,,,32,,32||||50|,,,,,Water]Kommo-o||WhiteHerb|Overcoat|ClangingScales,AuraSphere,Flamethrower,Protect|Modest|2,,,32,,32||||50|,,,,,Steel';
  const P2_PACKED = 'Charizard||CharizarditeY|Blaze|HeatWave,AirSlash,SolarBeam,Protect|Timid|2,,,32,,32||||50|,,,,,Fire]Garchomp||LifeOrb|RoughSkin|Earthquake,DragonClaw,RockSlide,Protect|Jolly|2,,,32,,32||||50|,,,,,Ground]Archaludon||WhiteHerb|Stamina|DracoMeteor,FlashCannon,Thunderbolt,DragonPulse|Modest|2,,,32,,32||||50|,,,,,Steel]Pelipper||SitrusBerry|Drizzle|Hurricane,WeatherBall,Tailwind,Protect|Modest|2,,,32,,32||||50|,,,,,Water]Basculegion-F||MysticWater|SwiftSwim|HydroPump,ShadowBall,IceBeam,Surf|Modest|2,,,32,,32||||50|,,,,,Water]Grimmsnarl||LightClay|Prankster|SpiritBreak,LightScreen,FakeOut,Reflect|Careful|2,,,32,,32||||50|,,,,,Dark';

  // 3. Pre-populate teams into localStorage
  const team1Line = `[${format}]Champions Reg M-B (Rain/Sun Team)|${P2_PACKED}`;
  const team2Line = `[${format}]Champions Reg M-B (Sand/TrickRoom Team)|${P1_PACKED}`;
  
  try {
    let existing = localStorage.getItem('showdown_teams') || '';
    let newTeams = existing;
    if (!newTeams.includes('Champions Reg M-B (Sand/TrickRoom Team)')) {
      newTeams = team2Line + (newTeams ? '\n' + newTeams : '');
    }
    if (!newTeams.includes('Champions Reg M-B (Rain/Sun Team)')) {
      newTeams = team1Line + (newTeams ? '\n' + newTeams : '');
    }
    localStorage.setItem('showdown_teams', newTeams);
  } catch (e) {}

  function inBattle() {
    return !!(
      (window.location.hash && window.location.hash.includes('battle-')) ||
      (window.app && window.app.rooms && Object.keys(window.app.rooms).some(r => r.startsWith('battle-')))
    );
  }

  function startAutomation() {
    // Intercept Popup additions on app to completely silence handshake messages
    if (window.app && !window.app._popupIntercepted) {
      window.app._popupIntercepted = true;

      const origAddPopup = window.app.addPopup;
      window.app.addPopup = function (type, data) {
        if (data && typeof data.message === 'string') {
          if (
            data.message.includes('not found') ||
            data.message.includes('not challenging you') ||
            data.message.includes('security restrictions') ||
            data.message.includes('already using the name')
          ) {
            console.log('[Encoreable Autobattle] Silenced popup:', data.message);
            return null;
          }
        }
        if (type && (type.name === 'ProxyPopup' || type.name === 'LoginPasswordPopup')) {
          return null;
        }
        return origAddPopup.apply(this, arguments);
      };

      const origAddPopupMessage = window.app.addPopupMessage;
      window.app.addPopupMessage = function (message) {
        if (
          typeof message === 'string' &&
          (message.includes('not found') ||
           message.includes('not challenging you') ||
           message.includes('security restrictions') ||
           message.includes('already using the name'))
        ) {
          console.log('[Encoreable Autobattle] Silenced popup message:', message);
          return;
        }
        return origAddPopupMessage.apply(this, arguments);
      };

      if (window.app.closePopup) window.app.closePopup();
    }

    if (!window.app || !window.Storage) {
      setTimeout(startAutomation, 50);
      return;
    }

    try {
      if (typeof Storage.loadTeams === 'function') {
        Storage.loadTeams();
      }
    } catch (e) {}

    const selectedTeamPacked = (autoTeam === 'p2' ? P2_PACKED : P1_PACKED);

    // Wait until SockJS is ready
    let checkInterval = setInterval(() => {
      if (window.app && window.app.socket && window.app.socket.readyState === 1) {
        clearInterval(checkInterval);

        if (window.app.closePopup) window.app.closePopup();

        // 1. Rename to username immediately
        if (autoName) {
          app.send('/trn ' + autoName);
          if (window.app.closePopup) window.app.closePopup();
        }

        // 2. Set active team immediately
        setTimeout(() => {
          app.send('/utm ' + selectedTeamPacked);
        }, 200);

        // 3. Challenge loop (for Player 1)
        if (autoChallenge) {
          let challengeAttempts = 0;
          let challengeInterval = setInterval(() => {
            if (inBattle() || challengeAttempts >= 20) {
              clearInterval(challengeInterval);
              return;
            }
            challengeAttempts++;
            app.send(`/challenge ${autoChallenge}, ${format}`);
          }, 800);
        }

        // 4. Accept loop (for Player 2)
        if (autoAccept) {
          let acceptAttempts = 0;
          let acceptInterval = setInterval(() => {
            if (inBattle() || acceptAttempts >= 25) {
              clearInterval(acceptInterval);
              return;
            }
            acceptAttempts++;
            app.send(`/accept ${autoAccept}`);
          }, 600);
        }
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAutomation);
  } else {
    startAutomation();
  }
})();
