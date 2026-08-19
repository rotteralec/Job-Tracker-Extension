// scrapers.js — all the "where is the job title on this site" knowledge.
// Strategy (in order):
//   1. Site-specific selectors for LinkedIn / Indeed / Workday.
//   2. JSON-LD <script type="application/ld+json"> JobPosting data — many job
//      boards embed this for Google Jobs, and it's far more stable than HTML.
//   3. Generic fallbacks: og: meta tags, the page <h1>, highlighted text.
// Later strategies only fill fields the earlier ones missed.

window.JobScrapers = (() => {

  // Returns trimmed text of the first selector that matches anything.
  function text(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return clean(el.textContent);
    }
    return '';
  }

  function clean(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  // Turns an HTML string into readable plain text (JSON-LD descriptions are HTML).
  function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    // <br> and block elements become newlines so paragraphs survive.
    div.querySelectorAll('br, p, div, li, h1, h2, h3, h4').forEach(el => {
      el.insertAdjacentText('beforebegin', '\n');
    });
    return div.textContent
      .split('\n').map(line => line.trim()).join('\n')  // strip indentation
      .replace(/\n{3,}/g, '\n\n')                        // collapse blank-line runs
      .trim();
  }

  // Like text() but preserves paragraph structure — used for descriptions.
  function longText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) return htmlToText(el.innerHTML);
    }
    return '';
  }

  // ---- 1. Site-specific scrapers -------------------------------------------

  const SITES = [
    {
      name: 'LinkedIn',
      match: (host) => host.includes('linkedin.com'),
      // LinkedIn serves two different apps: the classic one (stable class
      // names, used on /jobs/collections/ and /jobs/search/) and a new one
      // on /jobs/view/ pages with obfuscated per-build class names. For the
      // new app, fall back to layout-proof anchors: the tab title
      // ("Job Title | Company | LinkedIn") and an aria-label.
      scrape: () => {
        const tabParts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ');
        const fromTab = tabParts.length >= 3 && tabParts.at(-1) === 'LinkedIn'
          ? { title: tabParts[0], company: tabParts[1] }
          : {};
        const companyAria = document.querySelector('[aria-label^="Company,"]');
        // New layout's header line: "Saline, MI · Reposted 1 day ago · 38 ..."
        const headerLine = (document.querySelector('main')?.innerText || '')
          .split('\n').map(l => l.trim())
          .find(l => l.includes(' · ') && /(ago|apply|applicant)/i.test(l)) || '';

        return {
          title: text([
            '.job-details-jobs-unified-top-card__job-title',  // classic detail panel
            '.jobs-unified-top-card__job-title',
            '.top-card-layout__title',                        // public job page
            'h1.t-24'
          ]) || clean(fromTab.title || ''),
          company: text([
            '.job-details-jobs-unified-top-card__company-name',
            '.jobs-unified-top-card__company-name',
            '.topcard__org-name-link'
          ]) || clean((companyAria?.getAttribute('aria-label') || '')
                 .replace(/^Company(,| logo for,)\s*/, '').replace(/\.$/, ''))
             || clean(fromTab.company || ''),
          location: text([
            '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
            '.jobs-unified-top-card__bullet',
            '.topcard__flavor--bullet'
          ]) || clean(headerLine.split('·')[0] || ''),
          // LinkedIn prepends its own "About the job" heading — drop it.
          // NOTE: the new /jobs/view/ layout doesn't include the JD in the
          // page at all; log from the collections/search view to capture it.
          description: longText([
            '#job-details',
            '.jobs-description__content',
            '.jobs-box__html-content',
            '.description__text'
          ]).replace(/^about the job\s*/i, '')
        };
      }
    },
    {
      name: 'Indeed',
      match: (host) => host.includes('indeed.'),
      scrape: () => ({
        title: text([
          'h1[data-testid="jobsearch-JobInfoHeader-title"]',
          'h1.jobsearch-JobInfoHeader-title',
          'h2[data-testid="simpler-jobTitle"]'
        ]),
        company: text([
          '[data-testid="inlineHeader-companyName"]',
          '[data-company-name="true"]',
          '[data-testid="company-name"]'
        ]),
        location: text([
          '[data-testid="inlineHeader-companyLocation"]',
          '[data-testid="job-location"]',
          '[data-testid="jobsearch-JobInfoHeader-companyLocation"]'
        ]),
        salary: text(['#salaryInfoAndJobType']),
        description: longText(['#jobDescriptionText'])
      })
    },
    {
      name: 'Workday',
      match: (host) => host.includes('myworkdayjobs.') || host.includes('myworkdaysite.'),
      scrape: () => ({
        title: text(['[data-automation-id="jobPostingHeader"]', 'h1']),
        // Company isn't labeled on Workday pages; the subdomain is the company
        // (e.g. acme.wd5.myworkdayjobs.com).
        company: clean(location.hostname.split('.')[0].replace(/-/g, ' ')),
        location: text(['[data-automation-id="locations"] dd', '[data-automation-id="locations"]']),
        description: longText(['[data-automation-id="jobPostingDescription"]'])
      })
    }
  ];

  // ---- 2. JSON-LD JobPosting (the generic gold mine) -----------------------

  function jsonLdJobPosting() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent);
        // Data may be a single object, an array, or nested under @graph.
        const candidates = [parsed].flat().flatMap(x => x && x['@graph'] ? x['@graph'] : [x]);
        for (const item of candidates) {
          if (!item) continue;
          const type = [].concat(item['@type'] || []);
          if (type.includes('JobPosting')) return item;
        }
      } catch (e) { /* malformed JSON-LD is common; skip it */ }
    }
    return null;
  }

  function fromJsonLd() {
    const jp = jsonLdJobPosting();
    if (!jp) return {};
    return {
      title: clean(jp.title || ''),
      company: clean(jp.hiringOrganization?.name || ''),
      location: formatJsonLdLocation(jp.jobLocation),
      salary: formatJsonLdSalary(jp.baseSalary),
      description: jp.description ? htmlToText(jp.description) : ''
    };
  }

  function formatJsonLdLocation(loc) {
    const first = [].concat(loc || [])[0];
    const addr = first?.address;
    if (!addr) return '';
    return clean([addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .filter(Boolean).join(', '));
  }

  function formatJsonLdSalary(sal) {
    if (!sal) return '';
    const v = sal.value || sal;
    const range = [v.minValue, v.maxValue].filter(Boolean).join('–');
    const amount = range || v.value || '';
    if (!amount) return '';
    const unit = v.unitText ? '/' + v.unitText.toLowerCase() : '';
    return clean(`${sal.currency || ''} ${amount}${unit}`);
  }

  // ---- 3. Last-resort generics ---------------------------------------------

  function genericFallback() {
    // Highlighted text is routed by what it looks like:
    //  - money-ish and short → salary field
    //  - long (a real JD is never short) → description
    //  - anything else short → ignored, to avoid clobbering good data
    const sel = clean(window.getSelection().toString());
    const looksLikeMoney = sel.length > 0 && sel.length < 60 &&
      /(?:[$€£]\s?\d|\d+\s?[kK]\b|\d+(?:[,.]\d+)?\s*(?:\/|per\s)(?:hr|hour|yr|year))/.test(sel);

    return {
      title: clean(
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector('h1')?.textContent || ''
      ),
      salary: looksLikeMoney ? sel : '',
      description: (!looksLikeMoney && sel.length >= 200) ? sel : ''
    };
  }

  // ---- Putting it together --------------------------------------------------

  function scrapeAll() {
    const result = { url: location.href, scrapedWith: [] };

    const site = SITES.find(s => s.match(location.hostname));
    const layers = [
      site ? { name: site.name, data: site.scrape() } : null,
      { name: 'JSON-LD', data: fromJsonLd() },
      { name: 'generic', data: genericFallback() }
    ].filter(Boolean);

    for (const layer of layers) {
      let used = false;
      for (const [key, value] of Object.entries(layer.data)) {
        if (value && !result[key]) { result[key] = value; used = true; }
      }
      if (used) result.scrapedWith.push(layer.name);
    }
    return result;
  }

  return { scrapeAll };
})();
