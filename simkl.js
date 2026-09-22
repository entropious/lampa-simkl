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

    // Категории родного «Избранного» и их пара в Simkl. «Нравится»,
    // «Запланировано», «Продолжение следует» и история остаются чисто
    // локальными: у Simkl нет статуса, который значил бы то же самое.
    // Синхронизация односторонняя, Lampa → Simkl: списки Lampa плагин не
    // трогает, чтобы не переписать то, что человек собирал руками.
    var FAVORITE_MAP = {
        look: 'watching',
        viewed: 'completed',
        wath: 'plantowatch',
        book: 'plantowatch',
        thrown: 'dropped'
    };

    var MENU_ID = 'lampa-simkl-menu';

    // Имя своего источника для Lampa.Api. Грид рисует родной category_full,
    // он берёт данные через Lampa.Api.list, а тот диспатчится по source.
    var SOURCE = 'simkl';

    // Разделы панели. Пока он один, поэтому пункт меню ведёт прямо в него —
    // прослойка из единственной строки только добавила бы нажатие.
    var SECTIONS = [
        { id: 'next', title: 'Смотреть дальше' }
    ];

    var TOKEN_KEY = 'simkl_token';
    var REFRESH_KEY = 'simkl_refresh';
    var EXPIRES_KEY = 'simkl_expires';
    var CACHE_KEY = 'simkl_status_cache';
    var CARDS_KEY = 'simkl_cards';
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
        #lampa-simkl-menu .menu__ico svg { width: 100%; height: 100%; }
        /* Вместо года в карточке стоит следующая серия с названием, а оно
           бывает длинным — обрезаем, чтобы ряд не разъезжался. */
        .simkl-card .card__age {
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
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

    // Разбивка по сериям нужна только когда открыли меню, и в Storage её не
    // кладём: у длинного сериала это сотни записей на тайтл.
    var episodes_cache = {};

    function fetchEpisodes(ctx, callback) {
        var key = cacheKey(ctx.method, ctx.card.id);

        if (episodes_cache[key]) return callback(episodes_cache[key]);

        api({
            path: '/sync/watched?extended=episodes,counters',
            method: 'POST',
            auth: true,
            body: [{ tmdb: Number(ctx.card.id), type: simklType(ctx.method) }],
            onDone: function (data) {
                var answer = Array.isArray(data) ? data[0] : null;
                var status = answer && answer.result !== 'not_found' ? answer : null;

                if (status) episodes_cache[key] = status;
                callback(status);
            },
            onFail: function () {
                Lampa.Noty.show('Simkl: не удалось получить список серий');
            }
        });
    }

    function invalidate(method, id) {
        var key = cacheKey(method, id);

        dropCache(key);
        delete episodes_cache[key];
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

    // --- Запись в Simkl ---------------------------------------------------

    // Simkl ищет тайтл по всем переданным полям сразу, поэтому отдаём и
    // название с годом, а не только tmdb-id: так меньше шансов промахнуться.
    function mediaBody(card, method, extra) {
        var item = { title: Core.cardTitle(card), ids: { tmdb: Number(card.id) } };
        var year = Core.cardYear(card);
        var body = {};

        if (year) item.year = year;
        if (extra) Object.keys(extra).forEach(function (name) { item[name] = extra[name]; });

        body[method === 'tv' ? 'shows' : 'movies'] = [item];
        return body;
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

    // Simkl отвечает успехом и тогда, когда не нашёл тайтл, так что ответ
    // приходится разбирать. По счётчикам added судить нельзя: они считают
    // изменения, и у повторной отметки уже отмеченного там честные нули.
    // Настоящий отказ виден только в not_found.
    function rejected(data) {
        var missing = (data && data.not_found) || {};

        return ['movies', 'shows', 'episodes'].some(function (kind) {
            return (missing[kind] || []).length > 0;
        });
    }

    // Отметка о просмотре — это событие, а не членство в списке, поэтому идёт
    // в /sync/history. Форма тела задаёт глубину: status без seasons — весь
    // сериал, seasons без episodes — сезон целиком, seasons с episodes —
    // отдельные серии.
    function sendHistory(ctx, extra, done_text) {
        api({
            path: '/sync/history',
            method: 'POST',
            auth: true,
            body: mediaBody(ctx.card, ctx.method, extra),
            onDone: function (data) {
                if (rejected(data)) return Lampa.Noty.show('Simkl: тайтл не найден');

                invalidate(ctx.method, ctx.card.id);
                Lampa.Noty.show('Simkl: ' + done_text);
                refresh(ctx);
            },
            onFail: function () {
                Lampa.Noty.show('Simkl: не удалось отметить');
            }
        });
    }

    function episodeCode(place) {
        function pad(value) { return value < 10 ? '0' + value : String(value); }
        return 'S' + pad(place.season) + 'E' + pad(place.episode);
    }

    // Первая вышедшая, но не отмеченная серия. Именно её отмечают чаще всего,
    // поэтому она выносится в меню отдельным пунктом — в одно нажатие.
    function nextEpisode(status) {
        var seasons = (status && status.seasons) || [];

        for (var i = 0; i < seasons.length; i++) {
            var episodes = seasons[i].episodes || [];

            for (var j = 0; j < episodes.length; j++) {
                if (episodes[j].aired && !episodes[j].watched) {
                    return { season: seasons[i].number, episode: episodes[j].number };
                }
            }
        }

        return null;
    }

    function openSeasonMenu(ctx, status, back) {
        var seasons = (status && status.seasons) || [];

        if (!seasons.length) return Lampa.Noty.show('Simkl: сезоны неизвестны');

        var items = seasons.map(function (season) {
            var total = season.episodes_aired || season.episodes_total || 0;

            return {
                title: 'Сезон ' + season.number,
                subtitle: season.episodes_watched + ' из ' + total + ' ' + episodeWord(total),
                season: season.number
            };
        });

        Lampa.Select.show({
            title: 'Отметить сезон целиком',
            items: items,
            onSelect: function (chosen) {
                Lampa.Controller.toggle(back);
                sendHistory(ctx, { seasons: [{ number: chosen.season }] },
                    'сезон ' + chosen.season + ' отмечен');
            },
            onBack: function () { Lampa.Controller.toggle(back); }
        });
    }

    function openEpisodeMenu(ctx) {
        if (!configured()) return Lampa.Noty.show('Simkl: не задан client_id');
        // После подключения только обновляем карточку. Открывать меню сразу
        // нельзя: оно перехватывает фокус в момент, когда человек ещё дожимает
        // подтверждение на телефоне, и случайный Enter молча отправляет в
        // Simkl первый пункт.
        if (!token()) return startPinAuth(function () { refresh(ctx); });

        // Куда вернуть фокус, когда список закроется. Имя контроллера карточки
        // от сборки к сборке менялось, поэтому спрашиваем текущий, а не зашиваем.
        var back = Lampa.Controller.enabled().name;

        fetchEpisodes(ctx, function (status) {
            var next = nextEpisode(status);
            var items = [];

            if (next) items.push({ title: 'Отметить ' + episodeCode(next), mark: next });

            items.push({ title: 'Сезон целиком…', seasons: true });
            items.push({ title: 'Весь сериал просмотрен', whole: true });
            items.push({ title: 'Открыть на Simkl', open: true });

            Lampa.Select.show({
                title: 'Simkl',
                items: items,
                onSelect: function (chosen) {
                    if (chosen.seasons) return openSeasonMenu(ctx, status, back);

                    Lampa.Controller.toggle(back);

                    if (chosen.open) return openOnSimkl(ctx);

                    if (chosen.mark) {
                        return sendHistory(ctx, {
                            seasons: [{ number: chosen.mark.season, episodes: [{ number: chosen.mark.episode }] }]
                        }, 'отмечено ' + episodeCode(chosen.mark));
                    }

                    if (chosen.whole) {
                        sendHistory(ctx, { status: 'completed' }, 'сериал отмечен просмотренным');
                    }
                },
                onBack: function () { Lampa.Controller.toggle(back); }
            });
        });
    }

    // --- Категории «Избранного» -------------------------------------------

    function ready() {
        return configured() && !!token();
    }

    function pushFavorite(card, list) {
        if (!ready()) return;

        var method = Core.cardMethod(card);

        api({
            path: '/sync/add-to-list',
            method: 'POST',
            auth: true,
            body: mediaBody(card, method, { to: list }),
            onDone: function (data) {
                if (rejected(data)) return Lampa.Noty.show('Simkl: тайтл не найден');

                invalidate(method, card.id);
                Lampa.Noty.show('Simkl: ' + LISTS[list]);
            },
            onFail: function () {
                Lampa.Noty.show('Simkl: не удалось изменить статус');
            }
        });
    }

    function dropFavorite(card, list) {
        if (!ready()) return;

        var method = Core.cardMethod(card);

        fetchStatus(method, card.id, function (status) {
            // Снимаем только то, что сами же и поставили. Если в Simkl лежит
            // другой статус, человек менял его там — затирать это нельзя.
            if (!status || status.list !== list) return;

            api({
                path: '/sync/history/remove',
                method: 'POST',
                auth: true,
                body: mediaBody(card, method, null),
                onDone: function () {
                    invalidate(method, card.id);
                    Lampa.Noty.show('Simkl: убрано из списков');
                }
            });
        });
    }

    function followFavorite() {
        Lampa.Favorite.listener.follow('add', function (e) {
            var list = e.card && FAVORITE_MAP[e.where];
            if (list) pushFavorite(e.card, list);
        });

        Lampa.Favorite.listener.follow('remove', function (e) {
            var list = e.card && FAVORITE_MAP[e.where];
            if (list) dropFavorite(e.card, list);
        });
    }

    function onCard(ctx) {
        if (!configured()) return;

        // Кнопка нужна только сериалу: у него надо выбрать, что именно
        // отмечено — серия, сезон или всё целиком. Фильму хватает категорий
        // родного «Избранного», там выбирать нечего.
        if (ctx.method === 'tv' && Lampa.Storage.get(BUTTON_KEY, true)) {
            Core.cardButton(ctx, {
                className: 'simkl-status-button',
                icon: ICON,
                title: 'Simkl',
                after: '.button--play',
                onEnter: function () { openEpisodeMenu(ctx); }
            });
        }

        refresh(ctx);
    }

    // --- Карточки TMDB -----------------------------------------------------

    // Грид рисует сама Lampa, и ей нужны карточки TMDB — с ними бесплатно
    // приезжают постер, оценка, бейдж типа и русское название.
    //
    // Русское название, кстати, из Simkl не достать: в поиске оно у него есть
    // («Игра престолов» находится), но наружу отдаются только английские —
    // language принимает единственное значение en, а language, locale и
    // title_language на детальных эндпоинтах молча игнорируются.
    //
    // Данные карточки не меняются, так что кэш вечный: платим запросами один
    // раз, при следующем открытии экрана он уже собран.
    var cards = {};
    var card_queue = [];
    var card_active = 0;

    // Три запроса разом: сорок параллельных телевизор не обрадуют, а по одному
    // экран собирался бы заметно долго.
    var CARD_WORKERS = 3;

    function loadCards() {
        try {
            cards = Lampa.Storage.get(CARDS_KEY, '{}') || {};
        } catch (e) {
            console.error('Simkl: не удалось прочитать кэш карточек', e);
        }
    }

    // Язык входит в ключ: после смены языка Lampa кэш не должен отдавать
    // карточку, набранную для прошлого.
    function cardKey(method, id) {
        return Lampa.Storage.get('language', 'ru') + ':' + method + ':' + id;
    }

    // В Storage кладём только то, из чего Lampa собирает карточку: полный
    // ответ TMDB с описанием и сезонами раздул бы хранилище на ровном месте.
    function trim(data, method) {
        return {
            id: data.id,
            name: data.name,
            title: data.title,
            original_name: data.original_name,
            original_title: data.original_title,
            poster_path: data.poster_path,
            backdrop_path: data.backdrop_path,
            first_air_date: data.first_air_date,
            release_date: data.release_date,
            vote_average: data.vote_average,
            source: 'tmdb',
            media_type: method
        };
    }

    function tmdbCard(method, id, callback) {
        var key = cardKey(method, id);

        if (cards[key]) return callback(cards[key]);

        card_queue.push({ key: key, method: method, id: id, done: callback });
        pumpCards();
    }

    function pumpCards() {
        if (!card_active && !card_queue.length) {
            try {
                Lampa.Storage.set(CARDS_KEY, cards);
            } catch (e) {
                console.error('Simkl: не удалось записать кэш карточек', e);
            }
            return;
        }

        while (card_active < CARD_WORKERS && card_queue.length) {
            run(card_queue.shift());
        }

        function run(task) {
            card_active++;

            // Через Lampa.Reguest и Lampa.TMDB, а не своим запросом: только так
            // работают пользовательские настройки ключа и прокси к TMDB.
            var url = Lampa.TMDB.api(task.method + '/' + task.id +
                '?api_key=' + Lampa.TMDB.key() +
                '&language=' + Lampa.Storage.get('language', 'ru'));

            function next() {
                card_active--;
                pumpCards();
            }

            new Lampa.Reguest().silent(url, function (data) {
                if (data && data.id) {
                    cards[task.key] = trim(data, task.method);
                    task.done(cards[task.key]);
                } else {
                    task.done(null);
                }

                next();
            }, function () {
                task.done(null);
                next();
            });
        }
    }

    // --- Экран «Смотреть дальше» -------------------------------------------

    function episodeLabel(next) {
        function pad(value) { return value < 10 ? '0' + value : String(value); }

        var code = 'S' + pad(next.season) + 'E' + pad(next.episode);
        return next.title ? code + ' · ' + next.title : code;
    }

    // Сначала то, что уже вышло и ждёт просмотра, свежее сверху; потом сериалы,
    // чья следующая серия ещё не вышла. Иначе анонсы будущих серий оттеснили бы
    // вниз ровно то, ради чего экран и открывают.
    function sortByNext(items) {
        var now = Date.now();

        return items.slice().sort(function (a, b) {
            var at = Date.parse(a.next_to_watch_info.date) || 0;
            var bt = Date.parse(b.next_to_watch_info.date) || 0;
            var a_aired = at <= now;
            var b_aired = bt <= now;

            if (a_aired !== b_aired) return a_aired ? -1 : 1;
            return a_aired ? bt - at : at - bt;
        });
    }

    // Подпись со следующей серией — единственное, чего нет у родной карточки:
    // под постером она показывает год, и пересчитывает его сама, так что
    // подсунуть текст через данные нельзя. Держим подписи отдельно и
    // проставляем их после отрисовки, находя карточку по её же card_data.
    var next_labels = {};

    // Данные приезжают уже после того, как активность отрисовалась, поэтому
    // одного события мало: проставляем и по нему, и сразу после отдачи
    // результатов, дав Lampa тик на отрисовку карточек.
    function scheduleLabels() {
        setTimeout(applyLabels, 0);
        setTimeout(applyLabels, 500);
    }

    function applyLabels() {
        var active = Lampa.Activity.active();
        if (!active || active.source !== SOURCE || !active.activity) return;

        active.activity.render().find('.card').each(function () {
            var data = this.card_data;
            var label = data && next_labels[data.id];

            if (label) $(this).addClass('simkl-card').find('.card__age').text(label);
        });
    }

    // Источник для родного category_full. Всё, что ему нужно, — метод list;
    // остальное наследуем от tmdb, чтобы карточка, открытая из грида, ходила
    // за деталями и сезонами ровно туда же, куда и всегда.
    function buildSource() {
        return Object.assign({}, Lampa.Api.sources.tmdb, {
            list: function (params, oncomplite, onerror) {
                if (!configured() || !token()) return onerror();

                api({
                    path: '/sync/all-items/shows/watching?extended=full&next_watch_info=yes',
                    auth: true,
                    onDone: function (data) {
                        var items = ((data && data.shows) || []).filter(function (item) {
                            return item && item.show && item.next_to_watch_info &&
                                item.show.ids && item.show.ids.tmdb;
                        });

                        if (!items.length) return onerror();

                        collect(sortByNext(items), oncomplite, onerror);
                    },
                    onFail: onerror
                });
            }
        });
    }

    // Родному гриду нужны карточки TMDB, а Simkl отдаёт только свои id и
    // английские названия. Собираем карточки по id — очередью, чтобы не
    // выстрелить сорока запросами разом.
    function collect(items, oncomplite, onerror) {
        var results = [];
        var waiting = items.length;

        next_labels = {};

        items.forEach(function (item, index) {
            var id = Number(item.show.ids.tmdb);

            tmdbCard('tv', id, function (card) {
                // Порядок важен — он и есть сортировка, — поэтому кладём по
                // индексу, а не по мере возвращения ответов.
                if (card) {
                    results[index] = card;
                    next_labels[card.id] = episodeLabel(item.next_to_watch_info);
                }

                if (--waiting) return;

                var ready_list = results.filter(Boolean);
                if (!ready_list.length) return onerror();

                oncomplite({ results: ready_list, total_pages: 1, page: 1 });
                scheduleLabels();
            });
        });
    }

    function addMenuItem() {
        var list = document.querySelector('.menu .menu__list');
        if (!list || document.getElementById(MENU_ID)) return;

        var item = $(
            '<li class="menu__item selector" id="' + MENU_ID + '">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">Simkl</div>' +
            '</li>'
        );

        // hover:enter покрывает и пульт, и мышь: вешать сюда ещё и click —
        // значит открыть экран дважды
        item.on('hover:enter', function () {
            Lampa.Activity.push({
                component: 'category_full',
                source: SOURCE,
                url: SECTIONS[0].id,
                title: SECTIONS[0].title,
                page: 1
            });
        });

        $(list).append(item);
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
        loadCards();
        addSettings();

        if (!configured()) {
            console.warn('Simkl: не задан CLIENT_ID, плагин ничего не покажет');
        }

        Lampa.Api.sources[SOURCE] = buildSource();

        // Подписи со следующей серией проставляем, когда грид уже отрисован
        Lampa.Listener.follow('activity', function (e) {
            if (e.type === 'complite') applyLabels();
        });

        // Lampa перерисовывает меню на старте и при смене профиля
        addMenuItem();
        setInterval(addMenuItem, 1000);

        Core.onFullCard(onCard);
        followFavorite();

        console.log('Simkl: plugin v' + manifest.version + ' ready');
    }

    Core.boot({
        flag: 'lampa_simkl_plugin',
        manifest: manifest,
        styles: { id: 'lampa-simkl-styles', css: STYLES },
        start: startPlugin
    });
})();
