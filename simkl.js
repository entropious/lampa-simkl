// Собрано build.py из lampa/core.js и plugins/simkl/plugin.js.
// Правки вносятся в исходники, этот файл перезаписывается.
// Общая обвязка для плагинов Lampa: запуск, манифест, стили, доступ к открытой
// карточке фильма и сеть. Файл вклеивается в начало каждого плагина сборкой
// (build.py), так что в рантайме он уже часть плагина и отдельным запросом не
// тянется.
(function () {
    'use strict';

    // Два собранных плагина несут по своей копии ядра. Первая выигрывает —
    // API у них одинаковое, а двойное определение ничего не даёт.
    if (window.LampaCore) return;

    var Core = {};

    // Lampa поднимается не мгновенно, а как расширение браузера плагин
    // выполняется вообще раньше страницы. Ждём готовности обоих.
    function waitForLampa(attempt, ready, giveup) {
        var available = typeof Lampa !== 'undefined' && Lampa.Storage && Lampa.Component &&
            Lampa.Activity && Lampa.Controller && Lampa.Listener && typeof window.$ === 'function';

        if (available) {
            if (window.appready) return ready();

            return Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') ready();
            });
        }

        if (attempt > 300) return giveup();

        setTimeout(function () { waitForLampa(attempt + 1, ready, giveup); }, 200);
    }

    // Часть плагинов кладёт в Manifest.plugins объект, часть — массив. Приводим
    // к массиву: иначе второй установленный плагин затирает запись первого, и
    // тот пропадает из списка расширений.
    function registerManifest(manifest) {
        if (!Array.isArray(Lampa.Manifest.plugins)) {
            Lampa.Manifest.plugins = Lampa.Manifest.plugins ? [Lampa.Manifest.plugins] : [];
        }

        var known = Lampa.Manifest.plugins.some(function (plugin) {
            return plugin && plugin.name === manifest.name;
        });

        if (!known) Lampa.Manifest.plugins.push(manifest);
    }

    // options: { flag, manifest, styles: { id, css }, start }
    Core.boot = function (options) {
        // Плагин может приехать дважды: и как расширение браузера, и из списка
        // плагинов Lampa. Второй раз просто выходим.
        if (window[options.flag]) return;
        window[options.flag] = true;

        waitForLampa(0, function () {
            registerManifest(options.manifest);
            if (options.styles) Core.addStyles(options.styles.id, options.styles.css);
            options.start();
        }, function () {
            console.error(options.manifest.name + ': Lampa так и не появилась, сдаёмся');
        });
    };

    Core.addStyles = function (id, css) {
        if (document.getElementById(id)) return;

        var style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
    };

    Core.stored = function (name, fallback) {
        return String(Lampa.Storage.get(name, fallback) || fallback);
    };

    // Разные источники зовут тип по-разному, а часть карточек не несёт его
    // вовсе — тогда опознаём по полям, которые есть только у сериалов.
    Core.cardMethod = function (data) {
        if (!data) return 'movie';
        if (data.method === 'movie' || data.method === 'tv') return data.method;
        if (data.media_type === 'movie' || data.media_type === 'tv') return data.media_type;
        if (data.type === 'movie' || data.type === 'tv') return data.type;
        return (data.number_of_seasons || data.first_air_date || data.name) ? 'tv' : 'movie';
    };

    Core.cardYear = function (card) {
        var year = Number(String((card && (card.release_date || card.first_air_date)) || '').slice(0, 4));
        return year || 0;
    };

    Core.cardTitle = function (card) {
        return (card && (card.title || card.name || card.original_title || card.original_name)) || '';
    };

    // Открытая карточка целиком: сама запись, её тип и корень активности.
    // Искать по документу нельзя — прошлые карточки остаются в DOM, и запрос
    // вернёт кнопки фильма, который человек уже закрыл.
    function currentCard() {
        var active = Lampa.Activity.active();
        var card = active && active.card;

        if (!card || !card.id || !active.activity) return null;

        var method = (active.method === 'movie' || active.method === 'tv')
            ? active.method
            : Core.cardMethod(card);

        return { card: card, method: method, render: active.activity.render(), activity: active.activity };
    }

    Core.currentCard = currentCard;

    // 'complite' — опечатка самой Lampa, событие приходит именно так
    Core.onFullCard = function (callback) {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var ctx = currentCard();
            if (ctx) callback(ctx);
        });
    };

    // Свежие сборки Lampa разметили карточку заново, старые ещё живут со
    // старыми классами — ищем по обоим.
    Core.cardButtons = function (ctx) {
        return ctx.render.find('.full-start-new__buttons, .full-start__buttons');
    };

    Core.cardLeft = function (ctx) {
        return ctx.render.find('.full-start-new__left, .full-start__left');
    };

    // Кнопка в ряду под постером. Разметку копируем у родных кнопок: Lampa сама
    // и стилизует её, и прячет подпись у второстепенных.
    // options: { className, icon, title, onEnter, after }
    Core.cardButton = function (ctx, options) {
        var container = Core.cardButtons(ctx);
        if (!container.length || container.find('.' + options.className).length) return null;

        var button = $(
            '<div class="full-start__button selector ' + options.className + '">' +
            (options.icon || '') +
            '<span>' + (options.title || '') + '</span>' +
            '</div>'
        );

        button.on('hover:enter', options.onEnter);

        var anchor = options.after ? container.find(options.after) : $();
        if (anchor.length) button.insertAfter(anchor.first());
        else container.prepend(button);

        return button;
    };

    // Строка вроде «сезон · серия» под названием. Кладём её туда же, куда
    // Lampa кладёт свои детали, чтобы она не висела отдельным блоком.
    Core.cardDetails = function (ctx, className, html) {
        var line = ctx.render.find('.' + className);

        if (!line.length) {
            line = $('<div class="full-start-new__details ' + className + '"></div>');

            var rate = ctx.render.find('.full-start-new__rate-line');
            var details = ctx.render.find('.full-start-new__details').not('.' + className);
            var left = Core.cardLeft(ctx);

            if (rate.length) line.insertAfter(rate.first());
            else if (details.length) line.insertAfter(details.first());
            else if (left.length) left.append(line);
            else return null;
        }

        line.html(html);
        return line;
    };

    function encodeBody(options) {
        if (options.form) {
            return Object.keys(options.form).map(function (name) {
                return encodeURIComponent(name) + '=' + encodeURIComponent(options.form[name]);
            }).join('&');
        }

        return options.body === undefined ? null : JSON.stringify(options.body);
    }

    // Свой XHR, а не Lampa.Reguest: тому нельзя передать заголовки, а без
    // Authorization запрос к чужому API не пройдёт. TMDB по-прежнему ходит
    // через Lampa.Reguest — там важны пользовательские настройки прокси.
    // Тело задаётся либо `body` (уедет как json), либо `form` (как
    // application/x-www-form-urlencoded, чего требуют эндпоинты OAuth).
    // options: { url, method, headers, body, form, timeout, onDone, onFail }
    Core.request = function (options) {
        var xhr = new XMLHttpRequest();
        var headers = options.headers || {};

        xhr.open(options.method || 'GET', options.url, true);
        Object.keys(headers).forEach(function (name) {
            xhr.setRequestHeader(name, headers[name]);
        });
        xhr.timeout = options.timeout || 15000;

        function fail(status, body) {
            if (options.onFail) options.onFail(status, body);
        }

        xhr.onload = function () {
            var parsed = null;

            try {
                if (xhr.responseText) parsed = JSON.parse(xhr.responseText);
            } catch (e) {
                // Тело не json — для успешного ответа это нормально (204),
                // для ошибки разбирать всё равно нечего.
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                if (options.onDone) options.onDone(parsed, xhr.status);
            } else {
                fail(xhr.status, parsed);
            }
        };

        xhr.onerror = function () { fail(0, null); };
        xhr.ontimeout = function () { fail(0, null); };

        xhr.send(encodeBody(options));

        return xhr;
    };

    window.LampaCore = Core;
})();

(function () {
    'use strict';

    var Core = window.LampaCore;

    var manifest = {
        type: 'other',
        version: '1.0.0',
        name: 'Simkl',
        description: 'Статус просмотра с simkl.com на карточке фильма и сериала'
    };

    // Своё приложение регистрируется на https://simkl.com/settings/developer/.
    // Нужен ключ приложения AUTH V2: device-флоу отвечает на ключ старого
    // приложения 401 invalid_client. Redirect URI плагин не использует вовсе —
    // у типа «TV, devices & command line» его и не спрашивают, а у «Mobile,
    // desktop & browser apps» достаточно вписать адрес своей Lampa.
    var CLIENT_ID = '1745cc52f39858acd8c80bf1e0180ed23d58eca0337803f8dd5825f085a63835';

    var API = 'https://api.simkl.com';

    // Simkl требует эту пару в каждом запросе наравне с client_id
    var APP_NAME = 'lampa-simkl';
    var APP_VERSION = '1.0.0';

    // Без media:write не получится менять статус: незнакомый скоуп Simkl молча
    // понижает до чтения, и промах вылезет только на первой записи.
    var SCOPE = 'media:read media:write';

    // CORS на api.simkl.com открыт, так что ходим напрямую — прокси, без
    // которого не живёт интеграция с Trakt, здесь не нужен.
    var LISTS = {
        watching: 'Смотрю',
        plantowatch: 'Буду смотреть',
        completed: 'Просмотрено',
        hold: 'Отложено',
        dropped: 'Брошено'
    };

    // Порядок в меню смены статуса: сначала то, что выбирают чаще.
    var LIST_ORDER = ['watching', 'completed', 'plantowatch', 'hold', 'dropped'];

    var TOKEN_KEY = 'simkl_token';
    var REFRESH_KEY = 'simkl_refresh';
    var EXPIRES_KEY = 'simkl_expires';
    var CACHE_KEY = 'simkl_status_cache';
    var LINE_KEY = 'simkl_card_line';
    var BUTTON_KEY = 'simkl_card_button';

    // Статус меняют и на самом simkl.com, поэтому кэш живёт недолго: он
    // спасает от повторного запроса при переходах туда-сюда по карточкам,
    // а не заменяет источник правды.
    var CACHE_TTL = 10 * 60 * 1000;

    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 14.3-4-4 1.6-1.6 2.4 2.4 5.2-5.2 1.6 1.6-6.8 6.8z"></path>' +
        '</svg>';

    var STYLES = `
        .full-start-new__details.simkl-status-line { display: flex; align-items: center; }
        .simkl-status-line .simkl-icon { width: 1.1em; height: 1.1em; margin-right: 0.4em; flex-shrink: 0; }
        .simkl-status-line .simkl-icon svg { width: 100%; height: 100%; display: block; }
        .simkl-pin { padding: 1.4em; text-align: center; }
        .simkl-pin__code {
            font-size: 2.4em; font-weight: 700; letter-spacing: 0.15em;
            margin: 0.4em 0 0.6em; word-break: break-all;
        }
        .simkl-pin__hint { opacity: 0.75; line-height: 1.5; }
        .simkl-pin__link { margin-top: 0.8em; opacity: 0.75; word-break: break-all; }
        .simkl-pin__link a { color: inherit; }
        .simkl-pin__state { margin-top: 1em; opacity: 0.6; }
        /* Lampa запрещает выделение на всём приложении — она про пульт. Но код
           и ссылку с мышью хочется скопировать, так что здесь возвращаем. */
        .simkl-pin__code, .simkl-pin__link {
            -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text; user-select: text;
            -webkit-touch-callout: default; cursor: text;
        }
    `;

    // Карточки живут в памяти и в Storage: при возврате на уже открытый фильм
    // строка статуса рисуется сразу, без мигания.
    var cache = {};
    // Одна и та же карточка может дорисоваться дважды — второй запрос ждёт
    // первого вместо того, чтобы уйти в сеть следом.
    var inflight = {};

    function token() {
        return Core.stored(TOKEN_KEY, '');
    }

    function configured() {
        return !!CLIENT_ID;
    }

    function cacheKey(method, id) {
        return method + ':' + id;
    }

    function loadCache() {
        try {
            var saved = Lampa.Storage.get(CACHE_KEY, '{}') || {};

            Object.keys(saved).forEach(function (key) {
                if (saved[key] && Date.now() - saved[key].at < CACHE_TTL) cache[key] = saved[key];
            });
        } catch (e) {
            console.error('Simkl: не удалось прочитать кэш', e);
        }
    }

    function persistCache() {
        try {
            Lampa.Storage.set(CACHE_KEY, cache);
        } catch (e) {
            console.error('Simkl: не удалось записать кэш', e);
        }
    }

    function dropCache(key) {
        delete cache[key];
        persistCache();
    }

    function clearCache() {
        cache = {};
        persistCache();
    }

    // client_id, app-name и app-version Simkl ждёт в строке запроса у каждого
    // эндпоинта, включая те, что не требуют токена.
    function withParams(path) {
        return API + path + (path.indexOf('?') === -1 ? '?' : '&') +
            'client_id=' + encodeURIComponent(CLIENT_ID) +
            '&app-name=' + encodeURIComponent(APP_NAME) +
            '&app-version=' + encodeURIComponent(APP_VERSION);
    }

    function send(options, may_retry) {
        var headers = { 'Content-Type': options.form ? 'application/x-www-form-urlencoded' : 'application/json' };
        if (options.auth) headers.Authorization = 'Bearer ' + token();

        return Core.request({
            url: withParams(options.path),
            method: options.method || 'GET',
            headers: headers,
            body: options.body,
            form: options.form,
            onDone: options.onDone,
            onFail: function (status, body) {
                // Токен живёт неделю, так что 401 — это чаще всего «протух»,
                // а не «отозвали». Обновляемся и повторяем ровно один раз.
                if (options.auth && status === 401 && may_retry) {
                    return renewToken(function (ok) {
                        if (ok) send(options, false);
                        else failed(options, status, body);
                    });
                }

                // После неудачного обновления держаться за токен бессмысленно:
                // честнее показать, что аккаунт отключён, чем сыпать ошибками
                // на каждой карточке.
                if (options.auth && (status === 401 || status === 403)) forgetToken();

                failed(options, status, body);
            }
        });
    }

    function failed(options, status, body) {
        console.error('Simkl: запрос', options.path, 'вернул', status, body);
        if (options.onFail) options.onFail(status, body);
    }

    // options: { path, method, body, form, auth, onDone, onFail }
    function api(options) {
        if (!options.auth) return send(options, false);

        if (!token()) {
            failed(options, 401, null);
            return null;
        }

        // Протухший токен видно по сохранённому сроку — меняем его заранее,
        // не тратя запрос на заведомый 401.
        if (!expired()) return send(options, true);

        renewToken(function (ok) {
            if (ok) send(options, false);
            else failed(options, 401, null);
        });

        return null;
    }

    function forgetToken() {
        Lampa.Storage.set(TOKEN_KEY, '');
        Lampa.Storage.set(REFRESH_KEY, '');
        Lampa.Storage.set(EXPIRES_KEY, 0);
        clearCache();
    }

    function saveTokens(data) {
        Lampa.Storage.set(TOKEN_KEY, data.access_token);
        // Обновление не ротирует refresh: в ответе приходит тот же самый,
        // и его собственный срок просто сдвигается вперёд.
        if (data.refresh_token) Lampa.Storage.set(REFRESH_KEY, data.refresh_token);

        // Минута запаса, чтобы не отправить запрос ровно в момент истечения
        var life = (Number(data.expires_in) || 0) * 1000;
        Lampa.Storage.set(EXPIRES_KEY, life ? Date.now() + life - 60000 : 0);
    }

    function expired() {
        var at = Number(Lampa.Storage.get(EXPIRES_KEY, 0)) || 0;
        return at > 0 && Date.now() >= at;
    }

    // Два параллельных обновления отрезали бы друг друга: каждое выдаёт новый
    // access_token и тут же хоронит предыдущий. Поэтому обновление одно, а
    // остальные ждут его результата.
    var renewing = null;

    function renewToken(callback) {
        var refresh = Core.stored(REFRESH_KEY, '');

        if (!refresh) {
            forgetToken();
            return callback(false);
        }

        if (renewing) return renewing.push(callback);
        renewing = [callback];

        function finish(ok) {
            var waiting = renewing;
            renewing = null;
            waiting.forEach(function (fn) { fn(ok); });
        }

        send({
            path: '/oauth2/token',
            method: 'POST',
            form: { grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh },
            onDone: function (data) {
                if (data && data.access_token) {
                    saveTokens(data);
                    finish(true);
                } else {
                    forgetToken();
                    finish(false);
                }
            },
            onFail: function () {
                forgetToken();
                finish(false);
            }
        }, false);
    }

    // --- Авторизация по коду (device flow) --------------------------------

    // Флоу для устройств без клавиатуры: показываем короткий код, человек
    // подтверждает его на simkl.com/pin с телефона, а мы всё это время
    // опрашиваем Simkl и получаем токен уже без участия пульта.
    function startPinAuth(onSuccess) {
        if (!configured()) return Lampa.Noty.show('Simkl: не задан client_id');

        var back = Lampa.Controller.enabled().name;
        var closed = false;

        var html = $(
            '<div class="simkl-pin">' +
            '<div class="simkl-pin__hint">Откройте <b>simkl.com/pin</b> на телефоне или компьютере и введите код</div>' +
            '<div class="simkl-pin__code">…</div>' +
            '<div class="simkl-pin__link"></div>' +
            '<div class="simkl-pin__state">Получаем код…</div>' +
            '</div>'
        );

        function state(text) {
            html.find('.simkl-pin__state').text(text);
        }

        function close() {
            closed = true;
            Lampa.Modal.close();
            Lampa.Controller.toggle(back);
        }

        Lampa.Modal.open({
            title: 'Подключение Simkl',
            html: html,
            size: 'medium',
            onBack: close
        });

        api({
            path: '/oauth2/device',
            method: 'POST',
            form: { client_id: CLIENT_ID, scope: SCOPE },
            onDone: function (data) {
                if (closed) return;

                if (!data || !data.user_code) {
                    return state('Simkl не выдал код, попробуйте ещё раз');
                }

                // Код показываем ровно как пришёл, вместе с дефисом: он часть
                // формата. Ссылку с уже подставленным кодом даём рядом — по ней
                // ничего вводить не придётся.
                html.find('.simkl-pin__code').text(data.user_code);

                if (data.verification_uri_complete) {
                    html.find('.simkl-pin__link')
                        .append($('<span>или сразу: </span>'))
                        .append($('<a target="_blank"></a>')
                            .attr('href', data.verification_uri_complete)
                            .text(data.verification_uri_complete));
                }
                state('Ждём подтверждения…');

                var deadline = Date.now() + (data.expires_in || 900) * 1000;
                var interval = Math.max(data.interval || 5, 5) * 1000;

                (function poll() {
                    if (closed) return;

                    // Отказ Simkl никак не помечает — при нажатии «нет» до
                    // самого конца приходит authorization_pending. Свой срок
                    // здесь единственное, что завершает цикл.
                    if (Date.now() > deadline) {
                        return state('Код истёк — закройте окно и начните заново');
                    }

                    api({
                        path: '/oauth2/token',
                        method: 'POST',
                        form: {
                            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                            client_id: CLIENT_ID,
                            device_code: data.device_code
                        },
                        onDone: function (answer) {
                            if (closed) return;

                            if (answer && answer.access_token) {
                                saveTokens(answer);
                                clearCache();
                                close();
                                Lampa.Noty.show('Simkl: аккаунт подключён');
                                if (onSuccess) onSuccess();
                                return;
                            }

                            setTimeout(poll, interval);
                        },
                        onFail: function (status, answer) {
                            if (closed) return;

                            var error = answer && answer.error;

                            if (error === 'expired_token') {
                                return state('Код истёк — закройте окно и начните заново');
                            }

                            // Чужой или V1-ключ: опрос этого не исправит
                            if (error === 'invalid_client') {
                                return state('client_id не подходит: нужно приложение AUTH V2');
                            }

                            // Опрос слишком частый. Ждать обязательно: неудачная
                            // попытка сама перезапускает окно, так что повтор
                            // без паузы держал бы нас в отказе до истечения кода.
                            if (error === 'slow_down') interval += 5000;

                            setTimeout(poll, interval);
                        }
                    });
                })();
            },
            onFail: function (status, answer) {
                if (closed) return;

                // Ключ старого приложения сюда не пускают, и это самая
                // вероятная причина отказа при первой настройке.
                if (answer && answer.error === 'invalid_client') {
                    return state('client_id не подходит: нужно приложение AUTH V2');
                }

                state('Не удалось получить код, проверьте client_id и сеть');
            }
        });
    }

    // --- Статус карточки -------------------------------------------------

    // Simkl отличает сериалы от фильмов на своей стороне, но tmdb-id в этих
    // двух каталогах нумеруются независимо — без type он найдёт не то кино.
    function simklType(method) {
        return method === 'tv' ? 'show' : 'movie';
    }

    function fetchStatus(method, id, callback) {
        var key = cacheKey(method, id);
        var hit = cache[key];

        if (hit && Date.now() - hit.at < CACHE_TTL) return callback(hit.status);

        if (inflight[key]) return inflight[key].push(callback);
        inflight[key] = [callback];

        function done(status) {
            cache[key] = { at: Date.now(), status: status };
            persistCache();

            var waiting = inflight[key] || [];
            delete inflight[key];
            waiting.forEach(function (fn) { fn(status); });
        }

        api({
            path: '/sync/watched?extended=counters',
            method: 'POST',
            auth: true,
            body: [{ tmdb: Number(id), type: simklType(method) }],
            onDone: function (data) {
                var answer = Array.isArray(data) ? data[0] : null;

                // result бывает трёх видов: true — лежит в списке, false —
                // Simkl знает тайтл, но у человека его нет, 'not_found' —
                // тайтла нет и в самом Simkl. Последние два для нас одно и то же.
                done(answer && answer.result === true ? answer : null);
            },
            onFail: function () {
                // Ошибку не кэшируем: следующая карточка попробует снова
                var waiting = inflight[key] || [];
                delete inflight[key];
                waiting.forEach(function (fn) { fn(null); });
            }
        });
    }

    // «из 8 серий», но «из 21 серии» — после числительного идёт родительный,
    // и у единицы он отличается.
    function episodeWord(count) {
        return count % 10 === 1 && count % 100 !== 11 ? 'серии' : 'серий';
    }

    // toLocaleDateString на части телевизоров отдаёт американский формат
    // независимо от локали, поэтому собираем дату руками.
    function formatDate(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';

        function pad(value) { return value < 10 ? '0' + value : String(value); }

        return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear();
    }

    function statusParts(status, method) {
        var parts = [LISTS[status.list] || 'В списке'];

        if (method === 'tv' && typeof status.episodes_watched === 'number') {
            var total = status.episodes_aired || status.episodes_total;

            if (total) {
                parts.push(status.episodes_watched + ' из ' + total + ' ' + episodeWord(total));
            }
        }

        var watched = formatDate(status.last_watched_at);
        if (watched) parts.push(watched);

        return parts;
    }

    function renderLine(ctx, status) {
        if (!status || !Lampa.Storage.get(LINE_KEY, true)) {
            ctx.render.find('.simkl-status-line').remove();
            return;
        }

        var parts = statusParts(status, ctx.method).map(function (part) {
            return '<span>' + part + '</span>';
        });

        Core.cardDetails(ctx, 'simkl-status-line',
            '<span class="simkl-icon">' + ICON + '</span>' +
            parts.join('<span class="full-start-new__split">●</span>'));
    }

    function renderButton(ctx, status) {
        var button = ctx.render.find('.simkl-status-button');
        if (!button.length) return;

        button.find('span').text(status ? (LISTS[status.list] || 'В списке') : 'Simkl');
    }

    function refresh(ctx) {
        if (!token()) {
            renderLine(ctx, null);
            renderButton(ctx, null);
            return;
        }

        fetchStatus(ctx.method, ctx.card.id, function (status) {
            // Пока ходили в сеть, человек мог уйти на другую карточку —
            // рисовать в её разметку чужой статус нельзя.
            var current = Core.currentCard();
            if (!current || current.card.id !== ctx.card.id) return;

            renderLine(ctx, status);
            renderButton(ctx, status);
        });
    }

    // --- Смена статуса ---------------------------------------------------

    // Simkl ищет тайтл по всем переданным полям сразу, поэтому отдаём и
    // название с годом, а не только tmdb-id: так меньше шансов промахнуться.
    function mediaItem(ctx) {
        var item = { title: Core.cardTitle(ctx.card), ids: { tmdb: Number(ctx.card.id) } };
        var year = Core.cardYear(ctx.card);

        if (year) item.year = year;
        return item;
    }

    function mediaBody(ctx, extra) {
        var item = mediaItem(ctx);
        var body = {};

        if (extra) Object.keys(extra).forEach(function (name) { item[name] = extra[name]; });

        body[ctx.method === 'tv' ? 'shows' : 'movies'] = [item];
        return body;
    }

    function applyStatus(ctx, list) {
        var request = list
            ? { path: '/sync/add-to-list', body: mediaBody(ctx, { to: list }) }
            : { path: '/sync/history/remove', body: mediaBody(ctx, null) };

        api({
            path: request.path,
            method: 'POST',
            auth: true,
            body: request.body,
            onDone: function () {
                dropCache(cacheKey(ctx.method, ctx.card.id));
                Lampa.Noty.show(list ? 'Simkl: ' + LISTS[list] : 'Simkl: убрано из списков');
                refresh(ctx);
            },
            onFail: function () {
                Lampa.Noty.show('Simkl: не удалось изменить статус');
            }
        });
    }

    function openOnSimkl(ctx) {
        // Ссылка обратно на Simkl — требование их правил использования API.
        // Simkl-id мы не знаем, но их redirect переводит tmdb-id в нужную
        // страницу сам. type обязателен: в TMDB фильмы и сериалы нумеруются
        // независимо, и без него redirect выберет не тот каталог.
        var url = withParams('/redirect?to=Simkl&tmdb=' + encodeURIComponent(ctx.card.id) +
            '&type=' + (ctx.method === 'tv' ? 'tv' : 'movie'));

        if (!window.open(url, '_blank')) Lampa.Noty.show('Не удалось открыть Simkl');
    }

    function openStatusMenu(ctx) {
        if (!configured()) return Lampa.Noty.show('Simkl: не задан client_id');
        // После подключения только обновляем карточку. Открывать список
        // статусов сразу нельзя: он перехватывает фокус в момент, когда человек
        // ещё дожимает подтверждение на телефоне, и случайный Enter молча
        // отправляет в Simkl первый пункт.
        if (!token()) return startPinAuth(function () { refresh(ctx); });

        // Куда вернуть фокус, когда список закроется. Имя контроллера карточки
        // от сборки к сборке менялось, поэтому спрашиваем текущий, а не зашиваем.
        var back = Lampa.Controller.enabled().name;

        fetchStatus(ctx.method, ctx.card.id, function (status) {
            var current = status ? status.list : '';

            var items = LIST_ORDER.map(function (list) {
                return { title: LISTS[list], list: list, selected: list === current };
            });

            if (status) items.push({ title: 'Убрать из списков', list: '' });
            items.push({ title: 'Открыть на Simkl', open: true });

            Lampa.Select.show({
                title: 'Simkl',
                items: items,
                onSelect: function (chosen) {
                    Lampa.Controller.toggle(back);

                    if (chosen.open) return openOnSimkl(ctx);
                    if (chosen.list !== current) applyStatus(ctx, chosen.list);
                },
                onBack: function () {
                    Lampa.Controller.toggle(back);
                }
            });
        });
    }

    function onCard(ctx) {
        if (!configured()) return;

        if (Lampa.Storage.get(BUTTON_KEY, true)) {
            Core.cardButton(ctx, {
                className: 'simkl-status-button',
                icon: ICON,
                title: 'Simkl',
                after: '.button--play',
                onEnter: function () { openStatusMenu(ctx); }
            });
        }

        refresh(ctx);
    }

    // --- Настройки -------------------------------------------------------

    // Строку состояния у кнопки приходится держать самим: Lampa рисует
    // значение только для параметров, которые сама же и хранит.
    var auth_field = null;

    function authLabel() {
        if (!configured()) return 'Не задан client_id';
        return token() ? 'Подключён' : 'Не подключён';
    }

    function updateAuthLabel() {
        if (auth_field) auth_field.find('.settings-param__value').text(authLabel());
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'simkl', name: 'Simkl', icon: ICON });

        Lampa.SettingsApi.addParam({
            component: 'simkl',
            param: { name: 'simkl_auth', type: 'button' },
            field: {
                name: 'Аккаунт Simkl',
                description: 'Подключение по коду на simkl.com/pin'
            },
            onRender: function (item) {
                auth_field = item;
                setTimeout(updateAuthLabel, 0);
            },
            onChange: function () {
                if (!configured()) return Lampa.Noty.show('Simkl: не задан client_id');

                if (token()) {
                    forgetToken();
                    Lampa.Noty.show('Simkl: аккаунт отключён');
                    updateAuthLabel();
                } else {
                    startPinAuth(updateAuthLabel);
                }
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'simkl',
            param: { name: LINE_KEY, type: 'trigger', default: true },
            field: {
                name: 'Статус под постером',
                description: 'Строка со списком, прогрессом по сериям и датой'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'simkl',
            param: { name: BUTTON_KEY, type: 'trigger', default: true },
            field: {
                name: 'Кнопка смены статуса',
                description: 'Кнопка Simkl в ряду под постером'
            }
        });
    }

    function startPlugin() {
        loadCache();
        addSettings();

        if (!configured()) {
            console.warn('Simkl: не задан CLIENT_ID, плагин ничего не покажет');
        }

        Core.onFullCard(onCard);

        console.log('Simkl: plugin v' + manifest.version + ' ready');
    }

    Core.boot({
        flag: 'lampa_simkl_plugin',
        manifest: manifest,
        styles: { id: 'lampa-simkl-styles', css: STYLES },
        start: startPlugin
    });
})();
