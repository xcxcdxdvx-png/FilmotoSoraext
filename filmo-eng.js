///////////////////////////////////////////////////////////////////////////////////////////
// Filmo.to module for Sora
// Language variant: English (ENG DUB)
// Preferred audio: en
//
// The filmo.to player page does not expose hoster URLs directly. It exposes encrypted
// provider tokens which must be exchanged at POST /n (with the page CSRF token and the
// session cookie) for a short-lived bridge token. The bridge then points at the real
// hoster embed. This module performs that flow and extracts the final HLS/MP4 URL.
///////////////////////////////////////////////////////////////////////////////////////////

var FILMO_BASE = 'https://filmo.to';
var FILMO_PREFERRED_LANGUAGE = 'en'; // 'de' or 'en'
var FILMO_LANGUAGE_LABEL = 'English (ENG DUB)';

var FILMO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function filmoLog(message) {
    try { console.log('[Filmo] ' + message); } catch (e) { }
}

///////////////////////////////////////////////////////////////////////////////////////////
// Network helpers
///////////////////////////////////////////////////////////////////////////////////////////

async function filmoRequest(url, options) {
    options = options || {};
    var headers = options.headers || {};
    var method = options.method || 'GET';
    var body = options.body == null ? null : options.body;

    if (!headers['User-Agent']) headers['User-Agent'] = FILMO_UA;
    if (!headers['Accept-Language']) headers['Accept-Language'] = 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7';

    try {
        if (typeof fetchv2 === 'function') {
            var response = await fetchv2(url, headers, method, body, true);
            var text = '';
            if (response) {
                if (typeof response.text === 'function') {
                    text = await response.text();
                } else if (typeof response === 'string') {
                    text = response;
                }
            }
            return {
                status: response && response.status ? response.status : 0,
                headers: (response && response.headers) || {},
                url: (response && (response.url || response.finalUrl)) || '',
                text: text || ''
            };
        }
    } catch (error) {
        filmoLog('fetchv2 failed for ' + url + ': ' + error);
    }

    try {
        if (typeof fetch === 'function') {
            var legacy = await fetch(url, headers);
            return { status: 200, headers: {}, text: typeof legacy === 'string' ? legacy : '' };
        }
    } catch (error2) {
        filmoLog('fetch failed for ' + url + ': ' + error2);
    }

    return { status: 0, headers: {}, text: '' };
}

function filmoJson(text) {
    if (!text) return null;
    try {
        return JSON.parse(String(text).replace(/^\uFEFF/, ''));
    } catch (error) {
        return null;
    }
}

///////////////////////////////////////////////////////////////////////////////////////////
// Small parsing helpers
///////////////////////////////////////////////////////////////////////////////////////////

function filmoDecodeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
        .replace(/&#([0-9]+);/g, function (_, dec) { return String.fromCharCode(parseInt(dec, 10)); })
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

function filmoStripTags(text) {
    return String(text == null ? '' : text).replace(/<[^>]*>/g, '');
}

function filmoCleanText(text) {
    return filmoDecodeHtml(filmoStripTags(text)).replace(/\s+/g, ' ').trim();
}

function filmoAttr(tag, name) {
    var quoted = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag);
    if (!quoted) quoted = new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'", 'i').exec(tag);
    return quoted ? filmoDecodeHtml(quoted[1]) : '';
}

function filmoOrigin(url) {
    var match = /^(https?:\/\/[^\/]+)/i.exec(String(url || ''));
    return match ? match[1] : '';
}

function filmoAbsoluteUrl(url, base) {
    var value = filmoDecodeHtml(String(url || '')).trim();
    if (!value) return '';
    if (value.indexOf('//') === 0) return 'https:' + value;
    if (/^https?:\/\//i.test(value)) return value;
    var origin = filmoOrigin(base || FILMO_BASE);
    if (value.charAt(0) === '/') return origin + value;
    return origin + '/' + value;
}

function filmoUnescapeSlashes(text) {
    return String(text == null ? '' : text)
        .replace(/\\u002[fF]/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\x2[fF]/g, '/')
        .replace(/\\x26/g, '&')
        .replace(/\\\//g, '/');
}

function filmoLastPathPart(url) {
    var clean = String(url || '').split('#')[0].split('?')[0].replace(/\/+$/, '');
    var parts = clean.split('/');
    return parts[parts.length - 1] || '';
}

///////////////////////////////////////////////////////////////////////////////////////////
// Search / details / episodes
///////////////////////////////////////////////////////////////////////////////////////////

function filmoLooksLikeHtml(value) {
    var text = String(value == null ? '' : value).trim();
    if (text.length < 80) return false;
    return /^<\s*(?:!doctype|html|head|body|div|article|main|section)\b/i.test(text) ||
        /<\/(?:html|body|article|div)>/i.test(text);
}

function filmoParseSearchHtml(html) {
    var results = [];
    var seen = {};

    var cardRegex = /<article[^>]*class="[^"]*popular-spotlight-card[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    var cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
        var block = cardMatch[1];
        var hrefMatch = /<a[^>]+href="([^"]+)"/i.exec(block);
        if (!hrefMatch) continue;
        var href = filmoAbsoluteUrl(hrefMatch[1], FILMO_BASE);
        if (!href || !/\/movies\//i.test(href) || seen[href]) continue;

        var imageMatch = /<img[^>]+src="([^"]+)"/i.exec(block);
        var titleMatch = /class="[^"]*popular-spotlight-card__title[^"]*"[^>]*>([\s\S]*?)<\/h4>/i.exec(block);
        if (!titleMatch) titleMatch = /<h4[^>]*>([\s\S]*?)<\/h4>/i.exec(block);

        seen[href] = true;
        results.push({
            title: filmoCleanText(titleMatch ? titleMatch[1] : filmoLastPathPart(href).replace(/-/g, ' ')),
            image: imageMatch ? filmoAbsoluteUrl(imageMatch[1], FILMO_BASE) : '',
            href: href
        });
    }

    if (results.length === 0) {
        var linkRegex = /<a[^>]+href="(https?:\/\/filmo\.to\/movies\/[^"]+)"[^>]*>([\s\S]{0,1200}?)<\/a>/gi;
        var linkMatch;
        while ((linkMatch = linkRegex.exec(html)) !== null) {
            var link = filmoAbsoluteUrl(linkMatch[1], FILMO_BASE);
            if (seen[link]) continue;
            var inner = linkMatch[2];
            var innerImg = /<img[^>]+src="([^"]+)"/i.exec(inner);
            var innerTitle = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(inner);
            seen[link] = true;
            results.push({
                title: filmoCleanText(innerTitle ? innerTitle[1] : filmoLastPathPart(link).replace(/-/g, ' ')),
                image: innerImg ? filmoAbsoluteUrl(innerImg[1], FILMO_BASE) : '',
                href: link
            });
        }
    }

    return results;
}

async function filmoSearchApi(query) {
    var response = await filmoRequest(FILMO_BASE + '/search/suggest?q=' + query, {
        headers: {
            'Referer': FILMO_BASE + '/',
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest'
        }
    });
    filmoLog('Search API status: ' + response.status + ', length: ' + String(response.text || '').length);

    var data = filmoJson(response.text);
    if (!data) return null;

    var movies = data.movies || data.results || data.data;
    if (!Array.isArray(movies)) return null;

    var results = [];
    var seen = {};
    for (var i = 0; i < movies.length; i++) {
        var movie = movies[i] || {};
        var href = filmoAbsoluteUrl(movie.url || movie.href || movie.link || '', FILMO_BASE);
        if (!href || !/\/movies\//i.test(href) || seen[href]) continue;
        var image = movie.image || movie.poster || movie.poster_url || movie.thumbnail || '';
        seen[href] = true;
        results.push({
            title: filmoCleanText(movie.title || movie.name || filmoLastPathPart(href).replace(/-/g, ' ')),
            image: image ? filmoAbsoluteUrl(image, FILMO_BASE) : '',
            href: href
        });
    }
    return results;
}

async function searchResults(keyword) {
    try {
        var input = String(keyword == null ? '' : keyword);

        // Some Sora modes pass the already-loaded search HTML instead of the keyword.
        if (filmoLooksLikeHtml(input)) {
            var inlineResults = filmoParseSearchHtml(input);
            filmoLog('Search results (inline HTML): ' + inlineResults.length);
            return JSON.stringify(inlineResults);
        }

        var query = encodeURIComponent(input.trim());

        // Start the regular search page early so API results can be enriched with posters.
        var htmlPromise = filmoRequest(FILMO_BASE + '/search?q=' + query, {
            headers: { 'Referer': FILMO_BASE + '/', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });

        // The site's own live-search endpoint is the most reliable source.
        var apiResults = null;
        try {
            apiResults = await filmoSearchApi(query);
        } catch (apiError) {
            filmoLog('Search API error: ' + apiError);
        }

        var html = '';
        try {
            var htmlResponse = await htmlPromise;
            html = htmlResponse.text || '';
            filmoLog('Search HTML status: ' + htmlResponse.status + ', length: ' + html.length);
        } catch (htmlError) {
            filmoLog('Search HTML error: ' + htmlError);
        }
        var htmlResults = filmoParseSearchHtml(html);

        if (apiResults && apiResults.length) {
            // Fill in missing posters from the HTML search page.
            var images = {};
            for (var h = 0; h < htmlResults.length; h++) {
                if (htmlResults[h].image) images[htmlResults[h].href] = htmlResults[h].image;
            }
            for (var a = 0; a < apiResults.length; a++) {
                if (!apiResults[a].image && images[apiResults[a].href]) {
                    apiResults[a].image = images[apiResults[a].href];
                }
            }
            filmoLog('Search results (API): ' + apiResults.length);
            return JSON.stringify(apiResults);
        }

        filmoLog('Search results (HTML): ' + htmlResults.length);
        return JSON.stringify(htmlResults);
    } catch (error) {
        filmoLog('Search error: ' + error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        var response = await filmoRequest(url, { headers: { 'Referer': FILMO_BASE + '/' } });
        var html = response.text || '';

        var descriptionMatch = /<p[^>]*class="[^"]*movie-detail-synopsis[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
        var description = descriptionMatch ? filmoCleanText(descriptionMatch[1]) : '';

        var dateMatch = /Erscheinungsdatum[\s\S]{0,300}?<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(html);
        var airdate = dateMatch ? filmoCleanText(dateMatch[1]) : '';
        if (airdate && /^\d{4}-\d{2}-\d{2}$/.test(airdate)) airdate = airdate.slice(0, 4);

        var runtimeMatch = /Laufzeit[\s\S]{0,300}?<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(html);
        var runtime = runtimeMatch ? filmoCleanText(runtimeMatch[1]) : '';

        var ratingMatch = /Bewertung[\s\S]{0,300}?<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(html);
        var rating = ratingMatch ? filmoCleanText(ratingMatch[1]) : '';

        var originalMatch = /Originalsprache[\s\S]{0,300}?<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(html);
        var original = originalMatch ? filmoCleanText(originalMatch[1]) : '';

        var genres = [];
        var genreBlock = /Genres[\s\S]{0,120}?<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(html);
        if (genreBlock) {
            var genreRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
            var genreMatch;
            while ((genreMatch = genreRegex.exec(genreBlock[1])) !== null) {
                var genre = filmoCleanText(genreMatch[1]);
                if (genre && genres.indexOf(genre) === -1) genres.push(genre);
            }
        }

        var directors = [];
        var directorBlock = /Regie[\s\S]{0,120}?<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(html);
        if (directorBlock) {
            var directorRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
            var directorMatch;
            while ((directorMatch = directorRegex.exec(directorBlock[1])) !== null) {
                var director = filmoCleanText(directorMatch[1]);
                if (director && directors.indexOf(director) === -1) directors.push(director);
            }
        }

        var aliases = [];
        if (genres.length) aliases.push('Genres: ' + genres.join(', '));
        if (runtime) aliases.push('Runtime: ' + runtime);
        if (directors.length) aliases.push('Director: ' + directors.join(', '));
        if (rating) aliases.push('Rating: ' + rating);
        if (original) aliases.push('Original language: ' + original);

        return JSON.stringify([{
            description: description || 'No description available',
            aliases: aliases.join(' | '),
            airdate: airdate || 'Unknown'
        }]);
    } catch (error) {
        filmoLog('Details error: ' + error);
        return JSON.stringify([{ description: 'Error loading description', aliases: '', airdate: 'Unknown' }]);
    }
}

async function extractEpisodes(url) {
    try {
        // Filmo is a movie site. A movie is exposed as one playable "episode" so Sora
        // can pass the movie URL to extractStreamUrl.
        return JSON.stringify([{ number: 1, href: url }]);
    } catch (error) {
        filmoLog('Episodes error: ' + error);
        return JSON.stringify([]);
    }
}

///////////////////////////////////////////////////////////////////////////////////////////
// Provider row / chip parsing
///////////////////////////////////////////////////////////////////////////////////////////

function filmoLanguageCode(label) {
    var value = String(label || '').toLowerCase();
    if (value.indexOf('deutsch') !== -1 || value.indexOf('german') !== -1 || value === 'de') return 'de';
    if (value.indexOf('english') !== -1 || value.indexOf('englisch') !== -1 || value === 'en') return 'en';
    return value;
}

function filmoHasClass(classAttribute, className) {
    var classes = String(classAttribute || '').split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
        if (classes[i] === className) return true;
    }
    return false;
}

function filmoParseProviderRows(html) {
    var rows = [];
    var headRegex = /<span[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;
    var heads = [];
    var headMatch;
    while ((headMatch = headRegex.exec(html)) !== null) {
        if (!filmoHasClass(headMatch[1], 'provider-row__lang')) continue;
        heads.push({ label: filmoCleanText(headMatch[2]), index: headMatch.index });
    }

    for (var i = 0; i < heads.length; i++) {
        var start = heads[i].index;
        var end = (i + 1 < heads.length) ? heads[i + 1].index : html.length;
        var segment = html.slice(start, end);
        var chips = [];

        var chipRegex = /<div[^>]*class="([^"]*)"[^>]*>/gi;
        var chipMatch;
        var starts = [];
        while ((chipMatch = chipRegex.exec(segment)) !== null) {
            if (!filmoHasClass(chipMatch[1], 'provider-chip')) continue;
            starts.push({ tag: chipMatch[0], index: chipMatch.index });
        }

        for (var j = 0; j < starts.length; j++) {
            var chipStart = starts[j].index;
            var chipEnd = (j + 1 < starts.length) ? starts[j + 1].index : segment.length;
            var chipBlock = segment.slice(chipStart, chipEnd);
            var tag = starts[j].tag;

            var p = filmoAttr(tag, 'data-p') || filmoAttr(chipBlock, 'data-p');
            var linkId = filmoAttr(tag, 'data-movie-link-id') || filmoAttr(chipBlock, 'data-movie-link-id');
            var label = filmoAttr(tag, 'aria-label');
            if (!label) {
                var labelMatch = /class="[^"]*provider-chip__name[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(chipBlock);
                label = labelMatch ? filmoCleanText(labelMatch[1]) : '';
            }

            var qualityTags = [];
            var qualityRegex = /class="[^"]*provider-chip__metadata-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
            var qualityMatch;
            while ((qualityMatch = qualityRegex.exec(chipBlock)) !== null) {
                var quality = filmoCleanText(qualityMatch[1]);
                if (quality && qualityTags.indexOf(quality) === -1) qualityTags.push(quality);
            }

            if (!p) continue;
            chips.push({
                label: label || 'Stream',
                linkId: linkId,
                p: p,
                quality: qualityTags.join(' '),
                language: filmoLanguageCode(heads[i].label),
                languageLabel: heads[i].label
            });
        }

        rows.push({ label: heads[i].label, language: filmoLanguageCode(heads[i].label), chips: chips });
    }

    return rows;
}

function filmoPickChips(rows) {
    var preferred = FILMO_PREFERRED_LANGUAGE;
    var other = preferred === 'de' ? 'en' : 'de';
    var order = [preferred, other];
    var result = [];
    var seen = {};

    for (var i = 0; i < order.length; i++) {
        for (var r = 0; r < rows.length; r++) {
            if (rows[r].language !== order[i]) continue;
            for (var c = 0; c < rows[r].chips.length; c++) {
                var chip = rows[r].chips[c];
                var key = chip.language + '|' + chip.linkId + '|' + chip.label + '|' + chip.p.slice(0, 24);
                if (seen[key]) continue;
                seen[key] = true;
                chip.priority = i;
                result.push(chip);
            }
        }
    }
    return result;
}

function filmoExtractCsrf(html) {
    var match = /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i.exec(html);
    if (!match) match = /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']csrf-token["']/i.exec(html);
    if (!match) match = /<input[^>]*name=["']_token["'][^>]*value=["']([^"']+)["']/i.exec(html);
    return match ? filmoDecodeHtml(match[1]) : '';
}

///////////////////////////////////////////////////////////////////////////////////////////
// Mint / bridge flow
///////////////////////////////////////////////////////////////////////////////////////////

async function filmoPostMint(p, csrf, referer) {
    var response = await filmoRequest(FILMO_BASE + '/n', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'X-CSRF-TOKEN': csrf,
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': FILMO_BASE,
            'Referer': referer
        },
        body: { p: p }
    });

    var data = filmoJson(response.text);
    if (data && data.x) return { token: data.x, status: response.status };

    // Laravel also accepts a classic form post. Try it if the JSON route failed.
    if (response.status !== 419 && response.status !== 0) {
        var formResponse = await filmoRequest(FILMO_BASE + '/n', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*',
                'X-CSRF-TOKEN': csrf,
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': FILMO_BASE,
                'Referer': referer
            },
            body: '_token=' + encodeURIComponent(csrf) + '&p=' + encodeURIComponent(p)
        });
        var formData = filmoJson(formResponse.text);
        if (formData && formData.x) return { token: formData.x, status: formResponse.status };
        return { token: null, status: formResponse.status };
    }

    return { token: null, status: response.status };
}

async function filmoMintToken(movieUrl, p, csrf) {
    var mint = await filmoPostMint(p, csrf, movieUrl);
    if (mint.token) return mint.token;

    if (mint.status === 419 || mint.status === 0) {
        filmoLog('Mint needs a fresh session, refreshing ' + movieUrl);
        var page = await filmoRequest(movieUrl, { headers: { 'Referer': FILMO_BASE + '/' } });
        var freshCsrf = filmoExtractCsrf(page.text || '');
        if (freshCsrf) {
            mint = await filmoPostMint(p, freshCsrf, movieUrl);
            if (mint.token) return mint.token;
        }
    }

    return null;
}

function filmoExtractBridgeTarget(html) {
    if (!html) return '';

    // The normal bridge page contains: <a class="open" href="https://hoster/...">
    var tagRegex = /<a\b[^>]*>/gi;
    var tagMatch;
    while ((tagMatch = tagRegex.exec(html)) !== null) {
        var tag = tagMatch[0];
        if (!/class=["'][^"']*\bopen\b/i.test(tag)) continue;
        var href = filmoAttr(tag, 'href');
        if (href) return filmoUnescapeSlashes(filmoDecodeHtml(href));
    }

    var patterns = [
        /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
        /window\.location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
        /window\.location\.assign\s*\(\s*["']([^"']+)["']\s*\)/i,
        /location\.href\s*=\s*["']([^"']+)["']/i,
        /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*?url\s*=\s*["']?([^"'\s>]+)/i
    ];
    for (var i = 0; i < patterns.length; i++) {
        var match = patterns[i].exec(html);
        if (match && match[1]) return filmoUnescapeSlashes(filmoDecodeHtml(match[1]));
    }

    // Last resort: any external anchor that leaves filmo.to.
    var anchorRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    var anchorMatch;
    while ((anchorMatch = anchorRegex.exec(html)) !== null) {
        var target = filmoUnescapeSlashes(filmoDecodeHtml(anchorMatch[1]));
        if (target && target.indexOf(FILMO_BASE) !== 0) return target;
    }

    return '';
}

async function filmoResolveBridge(token, referer) {
    var url = FILMO_BASE + '/n/' + encodeURIComponent(token);
    var html = '';
    var finalUrl = '';

    for (var hop = 0; hop < 4; hop++) {
        var response = await filmoRequest(url, { headers: { 'Referer': referer, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' } });
        html = response.text || '';
        finalUrl = response.url || url;

        // If the runtime exposes redirects, use the Location header first.
        var target = '';
        var headers = response.headers || {};
        var location = headers.location || headers.Location || '';
        if (location) target = location;
        if (!target) target = filmoExtractBridgeTarget(html);
        if (!target && response.url && String(response.url).indexOf(FILMO_BASE) !== 0) {
            target = response.url;
        }
        if (!target) break;

        target = filmoAbsoluteUrl(target, FILMO_BASE);
        if (!target) break;

        // Another filmo gate page: follow it.
        if (target.indexOf(FILMO_BASE) === 0 && /\/n\//i.test(target)) {
            url = target;
            continue;
        }

        return { url: target, html: '', finalUrl: finalUrl };
    }

    return { url: '', html: html, finalUrl: finalUrl };
}

///////////////////////////////////////////////////////////////////////////////////////////
// AES-256-GCM (pure JS) for Byse encrypted playback payloads
///////////////////////////////////////////////////////////////////////////////////////////

var AES_SBOX = new Uint8Array([
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
]);

function aesXtime(a) {
    return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
}

function aesGmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}

function aesExpandKey(key) {
    var nk = key.length / 4;
    var nr = nk + 6;
    var w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    var rcon = 1;
    for (var i = nk; i < 4 * (nr + 1); i++) {
        var t0 = w[4 * (i - 1)];
        var t1 = w[4 * (i - 1) + 1];
        var t2 = w[4 * (i - 1) + 2];
        var t3 = w[4 * (i - 1) + 3];
        if (i % nk === 0) {
            var tmp = t0;
            t0 = AES_SBOX[t1];
            t1 = AES_SBOX[t2];
            t2 = AES_SBOX[t3];
            t3 = AES_SBOX[tmp];
            t0 ^= rcon;
            rcon = aesXtime(rcon);
        } else if (nk > 6 && i % nk === 4) {
            t0 = AES_SBOX[t0];
            t1 = AES_SBOX[t1];
            t2 = AES_SBOX[t2];
            t3 = AES_SBOX[t3];
        }
        w[4 * i] = w[4 * (i - nk)] ^ t0;
        w[4 * i + 1] = w[4 * (i - nk) + 1] ^ t1;
        w[4 * i + 2] = w[4 * (i - nk) + 2] ^ t2;
        w[4 * i + 3] = w[4 * (i - nk) + 3] ^ t3;
    }
    return { w: w, nr: nr };
}

function aesAddRoundKey(s, w, round) {
    for (var i = 0; i < 16; i++) s[i] ^= w[16 * round + i];
}

function aesSubBytes(s) {
    for (var i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
}

function aesShiftRows(s) {
    var t = s.slice();
    s[1] = t[5]; s[5] = t[9]; s[9] = t[13]; s[13] = t[1];
    s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
    s[3] = t[15]; s[7] = t[3]; s[11] = t[7]; s[15] = t[11];
}

function aesMixColumns(s) {
    for (var c = 0; c < 4; c++) {
        var i = 4 * c;
        var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
        s[i] = aesGmul(a0, 2) ^ aesGmul(a1, 3) ^ a2 ^ a3;
        s[i + 1] = a0 ^ aesGmul(a1, 2) ^ aesGmul(a2, 3) ^ a3;
        s[i + 2] = a0 ^ a1 ^ aesGmul(a2, 2) ^ aesGmul(a3, 3);
        s[i + 3] = aesGmul(a0, 3) ^ a1 ^ a2 ^ aesGmul(a3, 2);
    }
}

function aesEncryptBlock(block, ks) {
    var s = block.slice();
    aesAddRoundKey(s, ks.w, 0);
    for (var round = 1; round < ks.nr; round++) {
        aesSubBytes(s);
        aesShiftRows(s);
        aesMixColumns(s);
        aesAddRoundKey(s, ks.w, round);
    }
    aesSubBytes(s);
    aesShiftRows(s);
    aesAddRoundKey(s, ks.w, ks.nr);
    return s;
}

function aesXorInto(a, b) {
    for (var i = 0; i < 16; i++) a[i] ^= b[i];
}

function aesGfMul128(x, y) {
    var z = new Uint8Array(16);
    var v = y.slice();
    for (var i = 0; i < 128; i++) {
        if ((x[i >> 3] >> (7 - (i & 7))) & 1) aesXorInto(z, v);
        var lsb = v[15] & 1;
        for (var j = 15; j > 0; j--) v[j] = (v[j] >> 1) | ((v[j - 1] & 1) << 7);
        v[0] >>= 1;
        if (lsb) v[0] ^= 0xe1;
    }
    return z;
}

function aesGhashUpdate(y, h, data) {
    var i = 0;
    for (; i + 16 <= data.length; i += 16) {
        aesXorInto(y, data.subarray(i, i + 16));
        y = aesGfMul128(y, h);
    }
    // GHASH pads each input to a full block before the next input starts.
    if (i < data.length) {
        var last = new Uint8Array(16);
        last.set(data.subarray(i));
        aesXorInto(y, last);
        y = aesGfMul128(y, h);
    }
    return y;
}

function aesWriteUint64BE(out, off, value) {
    var hi = Math.floor(value / 0x100000000);
    var lo = value >>> 0;
    out[off] = (hi >>> 24) & 255;
    out[off + 1] = (hi >>> 16) & 255;
    out[off + 2] = (hi >>> 8) & 255;
    out[off + 3] = hi & 255;
    out[off + 4] = (lo >>> 24) & 255;
    out[off + 5] = (lo >>> 16) & 255;
    out[off + 6] = (lo >>> 8) & 255;
    out[off + 7] = lo & 255;
}

function aesIncrementCounter(counter) {
    for (var i = 15; i >= 12; i--) {
        counter[i] = (counter[i] + 1) & 255;
        if (counter[i] !== 0) break;
    }
}

function aesGcmDecrypt(key, iv, ciphertextWithTag) {
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
        throw new Error('Invalid AES key length: ' + key.length);
    }
    var ks = aesExpandKey(key);
    var tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
    var ct = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

    var zero = new Uint8Array(16);
    var h = aesEncryptBlock(zero, ks);

    var j0 = new Uint8Array(16);
    j0.set(iv);
    j0[15] = 1;

    var lengthBlock = new Uint8Array(16);
    aesWriteUint64BE(lengthBlock, 0, 0);
    aesWriteUint64BE(lengthBlock, 8, ct.length * 8);

    var y = new Uint8Array(16);
    y = aesGhashUpdate(y, h, ct);
    y = aesGhashUpdate(y, h, lengthBlock);
    var tagMask = aesEncryptBlock(j0, ks);
    aesXorInto(y, tagMask);

    var diff = 0;
    for (var i = 0; i < 16; i++) diff |= y[i] ^ tag[i];
    if (diff !== 0) throw new Error('AES-GCM authentication failed');

    var counter = j0.slice();
    var out = new Uint8Array(ct.length);
    for (var off = 0; off < ct.length; off += 16) {
        aesIncrementCounter(counter);
        var stream = aesEncryptBlock(counter, ks);
        var n = Math.min(16, ct.length - off);
        for (var k = 0; k < n; k++) out[off + k] = ct[off + k] ^ stream[k];
    }
    return out;
}

function aesBase64UrlDecode(input) {
    var s = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function filmoUtf8Decode(bytes) {
    var out = '';
    var i = 0;
    while (i < bytes.length) {
        var c = bytes[i++];
        if (c < 0x80) {
            out += String.fromCharCode(c);
        } else if (c >= 0xc0 && c < 0xe0 && i < bytes.length) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
        } else if (c >= 0xe0 && c < 0xf0 && i + 1 < bytes.length) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
        } else if (c >= 0xf0 && i + 2 < bytes.length) {
            var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
    }
    return out;
}

function filmoDecryptBysePlayback(playback) {
    if (!playback || !playback.key_parts || !playback.payload || !playback.iv) return null;

    var parts = playback.key_parts;
    var version = parseInt(playback.version, 10);
    if (!version || version < 1) version = 10;

    var iv = aesBase64UrlDecode(playback.iv);
    var payload = aesBase64UrlDecode(playback.payload);

    var candidates = [];
    var a = parts[version - 1];
    var b = parts[30 - version];
    if (a && b) {
        candidates.push([a, b]);
        candidates.push([b, a]);
    }

    var seen = {};
    for (var c = 0; c < candidates.length; c++) {
        var pair = candidates[c];
        var pairKey = pair[0] + '|' + pair[1];
        if (seen[pairKey]) continue;
        seen[pairKey] = true;

        try {
            var left = aesBase64UrlDecode(pair[0]);
            var right = aesBase64UrlDecode(pair[1]);
            var key = new Uint8Array(left.length + right.length);
            key.set(left, 0);
            key.set(right, left.length);
            if (key.length !== 16 && key.length !== 24 && key.length !== 32) continue;
            var plain = filmoUtf8Decode(aesGcmDecrypt(key, iv, payload));
            var parsed = filmoJson(plain);
            if (parsed) return parsed;
        } catch (error) {
            // try the reversed order
        }
    }

    return null;
}

///////////////////////////////////////////////////////////////////////////////////////////
// Hoster extractors
///////////////////////////////////////////////////////////////////////////////////////////

function filmoMakeStream(title, streamUrl, headers) {
    if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) return null;
    var stream = { title: title, streamUrl: streamUrl };
    if (headers) stream.headers = headers;
    return stream;
}

function filmoUnescapeUrl(value) {
    return filmoUnescapeSlashes(filmoDecodeHtml(String(value || ''))).trim();
}

function filmoCollectUrls(text) {
    var urls = [];
    var seen = {};
    var normalized = filmoUnescapeSlashes(String(text || ''));

    var patterns = [
        /(https?:\/\/[^"'\s<>\\]+?\.m3u8(?:\?[^"'\s<>\\]*)?)/gi,
        /(https?:\/\/[^"'\s<>\\]+?\.mp4(?:\?[^"'\s<>\\]*)?)/gi,
        /["'](?:file|src|source|url|stream|hls|hls2|hls3|hls4)["']\s*[:=]\s*["']([^"']+)["']/gi
    ];

    for (var p = 0; p < patterns.length; p++) {
        var match;
        while ((match = patterns[p].exec(normalized)) !== null) {
            var candidate = filmoUnescapeUrl(match[1]);
            if (!candidate || seen[candidate]) continue;
            if (!/^https?:\/\//i.test(candidate)) continue;
            if (!/\.(m3u8|mp4)(\?|$)/i.test(candidate)) continue;
            if (/doubleclick|googlesyndication|googleadservices|adservice|analytics|\.jpg|\.png|\.gif|\.webp/i.test(candidate)) continue;
            seen[candidate] = true;
            urls.push(candidate);
        }
    }

    return urls;
}

function filmoSortUrls(urls) {
    var hls = [];
    var mp4 = [];
    for (var i = 0; i < urls.length; i++) {
        if (/\.m3u8(\?|$)/i.test(urls[i])) hls.push(urls[i]);
        else mp4.push(urls[i]);
    }
    return hls.concat(mp4);
}

function filmoPackerUnbase(value, radix) {
    if (radix <= 36) return parseInt(value, radix);
    var alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (radix === 64) alphabet += '+/';
    var result = 0;
    for (var i = 0; i < value.length; i++) {
        var index = alphabet.indexOf(value.charAt(i));
        if (index < 0) return 0;
        result = result * radix + index;
    }
    return result;
}

function filmoUnpackPacker(source) {
    var match = /eval\(function\(p,a,c,k,e,(?:d|r)\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/i.exec(String(source || ''));
    if (!match) return '';

    var payload = match[1];
    var radix = parseInt(match[2], 10);
    var symtab = match[4].split('|');

    try {
        return payload.replace(/\b\w+\b/g, function (token) {
            var index = filmoPackerUnbase(token, radix);
            if (index >= 0 && index < symtab.length && symtab[index]) return symtab[index];
            return token;
        });
    } catch (error) {
        return '';
    }
}

function filmoExtractVoeSources(html) {
    var urls = [];

    // Current VOE layout: one obfuscated JSON array in a type="application/json" script.
    var jsonMatch = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (jsonMatch) {
        var parsed = filmoJson(jsonMatch[1]);
        if (parsed && Array.isArray(parsed) && typeof parsed[0] === 'string') {
            try {
                var decoded = filmoVoeDecode(parsed[0]);
                if (decoded) {
                    var collect = function (value) {
                        if (!value) return;
                        if (typeof value === 'string') {
                            if (/^https?:\/\//i.test(value)) urls.push(filmoUnescapeUrl(value));
                        } else if (Array.isArray(value)) {
                            for (var i = 0; i < value.length; i++) collect(value[i]);
                        } else if (typeof value === 'object') {
                            collect(value.direct_access_url);
                            collect(value.file);
                            collect(value.url);
                            collect(value.src);
                            collect(value.source);
                        }
                    };
                    collect(decoded.source);
                    collect(decoded.fallback);
                    collect(decoded.direct_access_url);
                }
            } catch (error) {
                filmoLog('VOE decode failed: ' + error);
            }
        }
    }

    if (urls.length === 0) {
        urls = filmoCollectUrls(html);
    }

    return filmoSortUrls(urls);
}

function filmoVoeDecode(input) {
    var value = String(input || '');

    // ROT13
    value = value.replace(/[a-zA-Z]/g, function (ch) {
        var code = ch.charCodeAt(0);
        var base = code <= 90 ? 65 : 97;
        return String.fromCharCode(((code - base + 13) % 26) + base);
    });

    // Remove the marker pairs used by VOE.
    var markers = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
    for (var i = 0; i < markers.length; i++) value = value.split(markers[i]).join('');

    value = filmoBase64Decode(value);
    value = value.replace(/[\s\S]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 3); });
    value = value.split('').reverse().join('');
    value = filmoBase64Decode(value);

    return filmoJson(value);
}

function filmoBase64Decode(value) {
    var input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (input.length % 4 !== 0) input += '=';
    try {
        return atob(input);
    } catch (error) {
        return '';
    }
}

async function filmoExtractVoe(embedUrl) {
    var response = await filmoRequest(embedUrl, {
        headers: { 'Referer': FILMO_BASE + '/', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
    });
    var html = response.text || '';
    var urls = filmoExtractVoeSources(html);
    var streams = [];
    for (var i = 0; i < urls.length && streams.length < 4; i++) {
        var stream = filmoMakeStream('VOE' + (i === 0 ? '' : ' ' + (i + 1)), urls[i]);
        if (stream) streams.push(stream);
    }
    return streams;
}

async function filmoExtractByse(embedUrl) {
    var origin = filmoOrigin(embedUrl);
    var code = filmoLastPathPart(embedUrl);
    if (!origin || !code) return [];

    var apiUrl = origin + '/api/videos/' + encodeURIComponent(code);
    var response = await filmoRequest(apiUrl, {
        headers: {
            'Accept': 'application/json',
            'Referer': embedUrl,
            'Origin': origin,
            'X-Requested-With': 'XMLHttpRequest'
        }
    });

    var data = filmoJson(response.text);
    if (!data) return [];

    var payload = data;
    if (data.playback) {
        var decrypted = filmoDecryptBysePlayback(data.playback);
        if (decrypted) payload = decrypted;
    }

    var streams = [];
    var sources = payload.sources || [];
    if (Array.isArray(sources)) {
        // Sort highest quality first.
        sources = sources.slice().sort(function (a, b) {
            return (Number(b.height) || 0) - (Number(a.height) || 0);
        });
        for (var i = 0; i < sources.length && streams.length < 4; i++) {
            var source = sources[i];
            if (!source || !source.url) continue;
            var label = source.label || (source.height ? source.height + 'p' : '');
            var title = 'Byse' + (label ? ' ' + label : '');
            var stream = filmoMakeStream(title, filmoUnescapeUrl(source.url));
            if (stream) streams.push(stream);
        }
    }

    return streams;
}

function filmoExtractVidoza(html) {
    var match = /<source[^>]+src=["']([^"']+)["'][^>]*type=["']video\/mp4["']/i.exec(html) ||
        /<source[^>]+type=["']video\/mp4["'][^>]*src=["']([^"']+)["']/i.exec(html);
    return match ? [match[1]] : [];
}

function filmoExtractVidmoly(html, url) {
    var urls = [];
    var sourceMatch = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i.exec(html);
    if (sourceMatch) urls.push(sourceMatch[1]);

    var optionRegex = /<option[^>]+value=["']([^"']+)["'][^>]*>\s*(?:SUB\s*-?\s*)?(?:Omega|SUB v2 - Omega)\s*<\/option>/gi;
    var optionMatch;
    while ((optionMatch = optionRegex.exec(html)) !== null) {
        try {
            var decoded = atob(optionMatch[1]);
            var iframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(decoded);
            if (iframe) urls.push(filmoAbsoluteUrl(iframe[1], url));
        } catch (error) { }
    }
    return urls;
}

function filmoExtractStreamwish(html, url) {
    var unpacked = filmoUnpackPacker(html);
    var urls = filmoCollectUrls(unpacked || html);
    return filmoSortUrls(urls);
}

function filmoExtractMixdrop(html) {
    var urls = [];
    var match = /(?:MDCore\.)?wurl\s*=\s*["']([^"']+)["']/i.exec(html) ||
        /MDCore\.wurl\s*=\s*["']([^"']+)["']/i.exec(html) ||
        /vsource\s*=\s*["']([^"']+)["']/i.exec(html);
    if (match) urls.push(filmoAbsoluteUrl(match[1], 'https://mixdrop.co'));
    return urls;
}

function filmoExtractMp4upload(html) {
    var match = /(?:src|file)\s*:\s*["']([^"']+\.mp4[^"']*)["']/i.exec(html) ||
        /player\.src\s*\(\s*["']([^"']+)["']/i.exec(html);
    return match ? [match[1]] : [];
}

function filmoExtractUqload(html) {
    var match = /sources\s*:\s*\[\s*["']([^"']+\.mp4)["']\s*\]/i.exec(html) ||
        /sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+\.mp4)["']/i.exec(html);
    return match ? [match[1]] : [];
}

function filmoExtractSendvid(html) {
    var match = /var\s+video_source\s*=\s*["']([^"']+)["']/i.exec(html) ||
        /video_source\s*:\s*["']([^"']+)["']/i.exec(html);
    return match ? [match[1]] : [];
}

function filmoExtractSibnet(html) {
    var match = /player\.src\s*\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i.exec(html) ||
        /src\s*:\s*["'](\/v\/[^"']+)["']/i.exec(html);
    if (!match) return [];
    var value = match[1];
    return [value.indexOf('http') === 0 ? value : 'https://video.sibnet.ru' + value];
}

function filmoExtractOkru(html) {
    var urls = [];
    var hls = /["']hlsManifestUrl["']\s*:\s*["']([^"']+)["']/i.exec(html);
    if (hls) urls.push(hls[1]);

    var optionsMatch = /data-options=["']([^"']+)["']/i.exec(html);
    if (optionsMatch) {
        try {
            var options = filmoJson(filmoDecodeHtml(optionsMatch[1]));
            var metadata = options && options.flashvars && options.flashvars.metadata;
            if (metadata) {
                var meta = typeof metadata === 'string' ? filmoJson(filmoDecodeHtml(metadata)) : metadata;
                if (meta && Array.isArray(meta.videos)) {
                    var best = meta.videos[meta.videos.length - 1];
                    if (best && best.url) urls.push(best.url);
                }
                if (meta && meta.hlsManifestUrl) urls.push(meta.hlsManifestUrl);
            }
        } catch (error) { }
    }
    return urls;
}

function filmoExtractVk(html) {
    var keys = ['url1080', 'url720', 'url480', 'url360', 'url240'];
    for (var i = 0; i < keys.length; i++) {
        var match = new RegExp('["\']' + keys[i] + '["\']\\s*:\\s*["\']([^"\']+)["\']', 'i').exec(html);
        if (match) return [filmoUnescapeUrl(match[1])];
    }
    var hls = /["']hls["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html);
    return hls ? [hls[1]] : [];
}

function filmoExtractEarnvids(html, url) {
    var unpacked = filmoUnpackPacker(html);
    var match = /["'](\/stream\/[^"']+)["']/i.exec(unpacked || '');
    if (match) return [filmoOrigin(url) + match[1]];
    return filmoCollectUrls(unpacked || html);
}

function filmoExtractVideospk(html) {
    var unpacked = filmoUnpackPacker(html);
    var match = /["'](\/stream\/[^"']+)["']/i.exec(unpacked || '');
    if (match) return ['https://videospk.xyz' + match[1]];
    return filmoCollectUrls(unpacked || html);
}

function filmoDetectProvider(html, url) {
    var host = (filmoOrigin(url) || '').toLowerCase();
    var text = String(html || '');

    if (host.indexOf('voe') !== -1 || /susanexpectcare|cloudwindow-route|<title>[^<]*VOE\b|"direct_access_url"\s*:/i.test(text)) return 'voe';
    if (host.indexOf('byse') !== -1 || /"key_parts"\s*:/.test(text)) return 'byse';
    if (host.indexOf('dood') !== -1 || /pass_md5/i.test(text)) return 'doodstream';
    if (host.indexOf('streamtape') !== -1 || /streamtape/i.test(text) || /link['"]\)\.innerHTML/i.test(text)) return 'streamtape';
    if (host.indexOf('vidoza') !== -1 || /vidoza/i.test(text)) return 'vidoza';
    if (host.indexOf('vidmoly') !== -1 || /vidmoly/i.test(text)) return 'vidmoly';
    if (host.indexOf('filemoon') !== -1 || /filemoon/i.test(text)) return 'filemoon';
    if (host.indexOf('streamwish') !== -1 || host.indexOf('wishfast') !== -1 || host.indexOf('streamhj') !== -1) return 'streamwish';
    if (host.indexOf('mixdrop') !== -1 || /MDCore\.wurl/i.test(text)) return 'mixdrop';
    if (host.indexOf('uqload') !== -1 || /uqload/i.test(text)) return 'uqload';
    if (host.indexOf('mp4upload') !== -1 || /mp4upload/i.test(text)) return 'mp4upload';
    if (host.indexOf('sendvid') !== -1 || /video_source/i.test(text)) return 'sendvid';
    if (host.indexOf('sibnet') !== -1 || /player\.src\s*\(/i.test(text)) return 'sibnet';
    if (host.indexOf('ok.ru') !== -1 || host.indexOf('odnoklassniki') !== -1) return 'okru';
    if (host.indexOf('vk.com') !== -1 || host.indexOf('vkvideo') !== -1) return 'vk';
    if (host.indexOf('lulu') !== -1) return 'lulu';
    if (host.indexOf('earnvids') !== -1) return 'earnvids';
    if (host.indexOf('videospk') !== -1) return 'videospk';
    return '';
}

function filmoNormalizeProvider(name, url) {
    var raw = String(name || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    var host = (filmoOrigin(url) || '').toLowerCase();

    if (raw.indexOf('voe') !== -1 || host.indexOf('voe') !== -1) return 'voe';
    if (raw.indexOf('byse') !== -1 || host.indexOf('byse') !== -1) return 'byse';
    if (raw.indexOf('streamtape') !== -1) return 'streamtape';
    if (raw.indexOf('dood') !== -1) return 'doodstream';
    if (raw.indexOf('vidoza') !== -1) return 'vidoza';
    if (raw.indexOf('vidmoly') !== -1) return 'vidmoly';
    if (raw.indexOf('filemoon') !== -1) return 'filemoon';
    if (raw.indexOf('streamwish') !== -1 || raw.indexOf('wishfast') !== -1 || raw.indexOf('streamhj') !== -1) return 'streamwish';
    if (raw.indexOf('mixdrop') !== -1) return 'mixdrop';
    if (raw.indexOf('uqload') !== -1) return 'uqload';
    if (raw.indexOf('mp4upload') !== -1) return 'mp4upload';
    if (raw.indexOf('sendvid') !== -1) return 'sendvid';
    if (raw.indexOf('sibnet') !== -1) return 'sibnet';
    if (raw.indexOf('okru') !== -1 || raw.indexOf('ok.ru') !== -1) return 'okru';
    if (raw.indexOf('vk') === 0 || raw.indexOf('vk') !== -1) return 'vk';
    if (raw.indexOf('lulu') !== -1) return 'lulu';
    if (raw.indexOf('earnvids') !== -1) return 'earnvids';
    if (raw.indexOf('videospk') !== -1) return 'videospk';
    return '';
}

async function filmoExtractDoodstream(html, embedUrl) {
    var match = /\/pass_md5\/([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)/i.exec(html);
    if (!match) return [];
    var origin = filmoOrigin(embedUrl);
    var response = await filmoRequest(origin + '/pass_md5/' + match[1] + '/' + match[2], {
        headers: { 'Referer': embedUrl, 'Accept': '*/*' }
    });
    var base = String(response.text || '').trim();
    if (!base || base === 'RELOAD' || !/^https?:\/\//i.test(base)) return [];

    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var random = '';
    for (var i = 0; i < 10; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
    return [base + random + '?token=' + match[2] + '&expiry=' + Date.now()];
}

async function filmoExtractStreamtape(html, embedUrl) {
    var urls = [];

    // The page builds the final URL from two pieces and a substring offset.
    var regex = /link['"]?\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(['"]([^'"]+)['"]\)\.substring\((\d+)\)/gi;
    var match;
    while ((match = regex.exec(html)) !== null) {
        var base = match[1];
        var params = match[2];
        var offset = parseInt(match[3], 10) || 0;
        var url = base + params.substring(offset);
        if (url.indexOf('//') === 0) url = 'https:' + url;
        if (url.indexOf('/') === 0) url = filmoOrigin(embedUrl) + url;
        urls.push(url);
    }

    if (urls.length === 0) urls = filmoCollectUrls(html);
    return urls;
}

function filmoExtractGeneric(html, embedUrl, provider) {
    var text = filmoUnpackPacker(html) || html;
    var urls = filmoCollectUrls(text);

    if (provider === 'vidoza') urls = urls.concat(filmoExtractVidoza(text));
    else if (provider === 'vidmoly') urls = urls.concat(filmoExtractVidmoly(text, embedUrl));
    else if (provider === 'mixdrop') urls = urls.concat(filmoExtractMixdrop(text));
    else if (provider === 'mp4upload') urls = urls.concat(filmoExtractMp4upload(text));
    else if (provider === 'uqload') urls = urls.concat(filmoExtractUqload(text));
    else if (provider === 'sendvid') urls = urls.concat(filmoExtractSendvid(text));
    else if (provider === 'sibnet') urls = urls.concat(filmoExtractSibnet(text));
    else if (provider === 'okru') urls = urls.concat(filmoExtractOkru(text));
    else if (provider === 'vk') urls = urls.concat(filmoExtractVk(text));
    else if (provider === 'lulu') urls = urls.concat(filmoCollectUrls(text));
    else if (provider === 'filemoon' || provider === 'streamwish') urls = urls.concat(filmoCollectUrls(text));

    // Remove duplicates.
    var unique = [];
    var seen = {};
    for (var i = 0; i < urls.length; i++) {
        var value = filmoUnescapeUrl(urls[i]);
        if (!value || seen[value]) continue;
        if (!/^https?:\/\//i.test(value)) continue;
        seen[value] = true;
        unique.push(value);
    }
    return filmoSortUrls(unique);
}

async function filmoExtractFromHtml(html, providerName, finalUrl) {
    if (!html) return [];

    var provider = filmoNormalizeProvider(providerName, finalUrl || '');
    var urls = [];

    // If the bridge redirected straight to a VOE player page, decode it directly.
    if (provider === 'voe' || /direct_access_url\s*:/i.test(html) || /susanexpectcare|cloudwindow-route/i.test(html)) {
        urls = filmoExtractVoeSources(html);
    }

    // If the bridge redirected straight to the Byse SPA, try to recover the video code.
    if (urls.length === 0 && (provider === 'byse' || /Byse Frontend|key_parts/i.test(html))) {
        var codeMatch = /\/d\/([A-Za-z0-9]+)/.exec(finalUrl || '') ||
            /"code"\s*:\s*"([A-Za-z0-9]+)"/i.exec(html) ||
            /\/api\/videos\/([A-Za-z0-9]+)/i.exec(html);
        if (codeMatch) {
            var origin = filmoOrigin(finalUrl || '') || 'https://bysezejataos.com';
            return await filmoExtractByse(origin + '/d/' + codeMatch[1]);
        }
    }

    if (urls.length === 0) urls = filmoCollectUrls(html);

    var streams = [];
    var seen = {};
    for (var i = 0; i < urls.length && streams.length < 4; i++) {
        var value = filmoUnescapeUrl(urls[i]);
        if (!value || seen[value]) continue;
        seen[value] = true;
        var title = providerName || provider || 'Stream';
        title = title.charAt(0).toUpperCase() + title.slice(1);
        var stream = filmoMakeStream(title + (streams.length === 0 ? '' : ' ' + (streams.length + 1)), value);
        if (stream) streams.push(stream);
    }
    return streams;
}

async function filmoExtractFromEmbed(embedUrl, providerName) {
    if (!embedUrl) return [];

    if (/\.(m3u8|mp4)(\?|$)/i.test(embedUrl)) {
        return [filmoMakeStream(providerName || 'Direct', embedUrl)];
    }

    var provider = filmoNormalizeProvider(providerName, embedUrl);

    if (provider === 'byse') return await filmoExtractByse(embedUrl);
    if (provider === 'voe') return await filmoExtractVoe(embedUrl);

    var response = await filmoRequest(embedUrl, {
        headers: { 'Referer': FILMO_BASE + '/', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
    });
    var html = response.text || '';

    if (!provider) provider = filmoDetectProvider(html, embedUrl);

    var urls = [];
    if (provider === 'doodstream') urls = await filmoExtractDoodstream(html, embedUrl);
    else if (provider === 'streamtape') urls = await filmoExtractStreamtape(html, embedUrl);
    else if (provider === 'vidoza') urls = filmoExtractVidoza(html);
    else if (provider === 'vidmoly') urls = filmoExtractVidmoly(html, embedUrl);
    else if (provider === 'filemoon') urls = filmoExtractStreamwish(html, embedUrl);
    else if (provider === 'streamwish') urls = filmoExtractStreamwish(html, embedUrl);
    else if (provider === 'mixdrop') urls = filmoExtractMixdrop(html);
    else if (provider === 'uqload') urls = filmoExtractUqload(html);
    else if (provider === 'mp4upload') urls = filmoExtractMp4upload(html);
    else if (provider === 'sendvid') urls = filmoExtractSendvid(html);
    else if (provider === 'sibnet') urls = filmoExtractSibnet(html);
    else if (provider === 'okru') urls = filmoExtractOkru(html);
    else if (provider === 'vk') urls = filmoExtractVk(html);
    else if (provider === 'lulu') urls = filmoCollectUrls(filmoUnpackPacker(html) || html);
    else if (provider === 'earnvids') urls = filmoExtractEarnvids(html, embedUrl);
    else if (provider === 'videospk') urls = filmoExtractVideospk(html);

    urls = filmoSortUrls(filmoExtractGeneric(html, embedUrl, provider).concat(urls));

    var streams = [];
    var seen = {};
    for (var i = 0; i < urls.length && streams.length < 4; i++) {
        var key = urls[i];
        if (seen[key]) continue;
        seen[key] = true;
        var title = providerName || provider || 'Stream';
        title = title.charAt(0).toUpperCase() + title.slice(1);
        var stream = filmoMakeStream(title + (streams.length === 0 ? '' : ' ' + (streams.length + 1)), key);
        if (stream) streams.push(stream);
    }

    return streams;
}

///////////////////////////////////////////////////////////////////////////////////////////
// Main stream entry point
///////////////////////////////////////////////////////////////////////////////////////////

async function extractStreamUrl(url) {
    try {
        var movieUrl = String(url || '');
        filmoLog('extractStreamUrl ' + movieUrl + ' (' + FILMO_LANGUAGE_LABEL + ')');

        var page = await filmoRequest(movieUrl, {
            headers: { 'Referer': FILMO_BASE + '/', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
        });
        var html = page.text || '';
        if (!html || html.indexOf('provider-chip') === -1) {
            filmoLog('No provider chips found');
            return JSON.stringify({ streams: [] });
        }

        var csrf = filmoExtractCsrf(html);
        var rows = filmoParseProviderRows(html);
        var chips = filmoPickChips(rows);
        filmoLog('Provider rows: ' + rows.length + ', chips: ' + chips.length);

        var streams = [];
        var seenStreams = {};
        for (var i = 0; i < chips.length; i++) {
            var chip = chips[i];
            if (chip.priority > 0 && streams.length > 0) {
                // The preferred language already produced streams; skip the fallback language.
                break;
            }

            try {
                var token = await filmoMintToken(movieUrl, chip.p, csrf);
                if (!token) {
                    filmoLog('No mint token for ' + chip.label);
                    continue;
                }

                var bridge = await filmoResolveBridge(token, movieUrl);
                var embedUrl = bridge && bridge.url ? bridge.url : '';
                var found = [];

                if (embedUrl) {
                    filmoLog('Resolved ' + chip.label + ' -> ' + embedUrl);
                    found = await filmoExtractFromEmbed(embedUrl, chip.label);
                } else {
                    // The fetch layer may have followed the bridge redirect to the hoster.
                    // In that case the response body is already the player page.
                    filmoLog('No bridge target for ' + chip.label + ', trying response body');
                    found = await filmoExtractFromHtml(bridge && bridge.html, chip.label, bridge && bridge.finalUrl);
                    if (!found.length) continue;
                }

                for (var f = 0; f < found.length; f++) {
                    var stream = found[f];
                    if (!stream || !stream.streamUrl || seenStreams[stream.streamUrl]) continue;
                    var quality = chip.quality ? ' (' + chip.quality + ')' : '';
                    stream.title = chip.label + quality + (found.length > 1 ? ' ' + (f + 1) : '');
                    seenStreams[stream.streamUrl] = true;
                    streams.push(stream);
                }
            } catch (error) {
                filmoLog('Chip ' + chip.label + ' failed: ' + error);
            }
        }

        filmoLog('Returning ' + streams.length + ' streams');
        return JSON.stringify({ streams: streams });
    } catch (error) {
        filmoLog('extractStreamUrl error: ' + error);
        return JSON.stringify({ streams: [] });
    }
}
