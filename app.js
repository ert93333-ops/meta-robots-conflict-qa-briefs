(function () {
  "use strict";

  const ANALYTICS_KEY = "metarobotsqa_analytics_events";
  const INTENT_KEY = "metarobotsqa_purchase_intents";
  const GITHUB_ISSUE_URL = "https://github.com/ert93333-ops/meta-robots-conflict-qa-briefs/issues/new";

  const SAMPLE_HEAD_ROWS = [
    'https://example.com/pricing | <meta name="robots" content="noindex,nofollow">',
    'https://example.com/blog/launch | <meta name="robots" content="index,follow"><meta name="bingbot" content="noindex,nosnippet">',
    'https://example.com/docs/migration | <meta name="googlebot" content="max-snippet:0,noarchive">',
    'https://staging.example.com/draft | <meta name="robots" content="noindex">',
  ].join("\n");

  const SAMPLE_HEADER_ROWS = [
    "https://example.com/pricing | X-Robots-Tag: index, follow",
    "https://example.com/assets/spec.pdf | X-Robots-Tag: noindex, noarchive",
    "https://example.com/docs/migration | X-Robots-Tag: max-snippet:20",
  ].join("\n");

  const SAMPLE_ROBOTS_NOTES = [
    "User-agent: *",
    "Disallow: /pricing",
    "Disallow: /staging",
    "Sitemap: https://example.com/sitemap.xml",
  ].join("\n");

  const state = {
    latestBrief: null,
    latestBriefText: "",
    lastRemoteBody: "",
    signupStarted: false,
    pricingTracked: false,
  };

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function setText(selector, value) {
    const element = qs(selector);
    if (element) element.textContent = value;
  }

  function readArray(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Local storage can be unavailable in privacy modes. The UI still works.
    }
  }

  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
    };
  }

  function track(eventName, detail) {
    const events = readArray(ANALYTICS_KEY);
    events.push({
      event: eventName,
      detail: detail || {},
      utm: getUtm(),
      path: window.location.pathname,
      createdAt: new Date().toISOString(),
    });
    writeArray(ANALYTICS_KEY, events.slice(-200));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function listHtml(items, emptyText) {
    if (!items.length) return "<p>" + escapeHtml(emptyText) + "</p>";
    return "<ul>" + items.map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("") + "</ul>";
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function parseUrl(value) {
    try {
      return new URL(clean(value));
    } catch (error) {
      return null;
    }
  }

  function normalizeUrl(value) {
    const url = parseUrl(value);
    if (!url) return clean(value).replace(/\/$/, "");
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  }

  function pathOf(value) {
    const url = parseUrl(value);
    return url ? url.pathname || "/" : "/";
  }

  function isStagingLike(value) {
    return /(^|[./-])(staging|stage|preview|dev|test|qa|localhost|draft)([./-]|$)/i.test(clean(value));
  }

  function extractUrls(raw) {
    const matches = clean(raw).match(/https?:\/\/[^\s<>"'|,]+/gi) || [];
    return matches.map(function (url) {
      return url.replace(/[),.;]+$/, "");
    });
  }

  function splitDirectives(value) {
    return clean(value)
      .toLowerCase()
      .split(",")
      .map(clean)
      .filter(Boolean);
  }

  function hasDirective(directives, name) {
    return directives.some(function (directive) {
      return directive === name || directive.indexOf(name + ":") === 0;
    });
  }

  function directiveSummary(map) {
    const keys = Object.keys(map);
    if (!keys.length) return "none";
    return keys.map(function (key) {
      return key + "=" + map[key].join(",");
    }).join("; ");
  }

  function parseMetaDirectives(snippet) {
    const directives = {};
    const source = clean(snippet);
    const metaPattern = /<meta\s+[^>]*name=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
    let match;
    while ((match = metaPattern.exec(source))) {
      const name = clean(match[1]).toLowerCase();
      if (!/^(robots|googlebot|bingbot)$/i.test(name)) continue;
      directives[name] = (directives[name] || []).concat(splitDirectives(match[2]));
    }

    const reversedPattern = /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']([^"']+)["'][^>]*>/gi;
    while ((match = reversedPattern.exec(source))) {
      const name = clean(match[2]).toLowerCase();
      if (!/^(robots|googlebot|bingbot)$/i.test(name)) continue;
      directives[name] = (directives[name] || []).concat(splitDirectives(match[1]));
    }

    Object.keys(directives).forEach(function (name) {
      directives[name] = Array.from(new Set(directives[name]));
    });
    return directives;
  }

  function parseHeadRows(raw) {
    return clean(raw).split(/\r?\n/).map(clean).filter(Boolean).map(function (line, index) {
      const urls = extractUrls(line);
      let parts = line.split("|").map(clean);
      if (parts.length < 2) parts = line.split(/\t/).map(clean);
      const url = urls[0] || parts[0] || "row " + (index + 1);
      const snippet = parts.slice(1).join(" | ") || line.replace(urls[0] || "", "");
      return {
        url: url,
        key: normalizeUrl(url),
        snippet: snippet,
        directives: parseMetaDirectives(snippet),
        raw: line,
      };
    });
  }

  function parseHeaderRows(raw) {
    const rows = clean(raw).split(/\r?\n/).map(clean).filter(Boolean).map(function (line, index) {
      const urls = extractUrls(line);
      const url = urls[0] || "header row " + (index + 1);
      const headerMatch = line.match(/x-robots-tag\s*:\s*([^|]+)/i);
      const content = headerMatch ? headerMatch[1] : line.replace(urls[0] || "", "");
      return {
        url: url,
        key: normalizeUrl(url),
        directives: splitDirectives(content),
        raw: line,
      };
    });
    return rows;
  }

  function robotsDisallows(raw) {
    return clean(raw).split(/\r?\n/).map(clean).filter(function (line) {
      return /^disallow\s*:/i.test(line);
    }).map(function (line) {
      return clean(line.replace(/^disallow\s*:/i, ""));
    }).filter(Boolean);
  }

  function isBlockedByRobots(url, rules) {
    const pathname = pathOf(url);
    return rules.some(function (rule) {
      if (rule === "/") return true;
      return pathname.indexOf(rule) === 0;
    });
  }

  function mapHas(map, directive) {
    return Object.keys(map).some(function (bot) {
      return hasDirective(map[bot], directive);
    });
  }

  function analyzeRobots(input) {
    const headRows = parseHeadRows(input.headRows);
    const headerRows = parseHeaderRows(input.headerRows);
    const headerByUrl = {};
    headerRows.forEach(function (row) {
      headerByUrl[row.key] = headerByUrl[row.key] || [];
      headerByUrl[row.key].push(row);
    });

    const launchIntent = clean(input.launchIntent);
    const expectsIndex = !/private|noindex/i.test(launchIntent);
    const disallows = robotsDisallows(input.robotsNotes);

    const parseSummary = [];
    const noindexWarnings = [];
    const snippetWarnings = [];
    const botConflictWarnings = [];
    const headerConflictWarnings = [];
    const accessReminders = [
      "Crawlers can only see page-level meta robots directives if they are allowed to access the page.",
      "Retest after staging templates, response headers, CDN rules, or robots.txt changes are released.",
      "Treat this as launch QA guidance; it does not guarantee indexing, crawling, or snippet outcomes.",
    ];

    if (!headRows.length) parseSummary.push("No URL/head rows were provided.");
    parseSummary.push("Parsed " + headRows.length + " URL/head rows.");
    parseSummary.push("Parsed " + headerRows.length + " X-Robots-Tag rows.");
    parseSummary.push("Parsed " + disallows.length + " robots.txt Disallow rules.");

    headRows.forEach(function (row, index) {
      const label = row.url || "row " + (index + 1);
      const generic = row.directives.robots || [];
      const googlebot = row.directives.googlebot || [];
      const bingbot = row.directives.bingbot || [];
      const allDirectives = generic.concat(googlebot).concat(bingbot);
      const headers = headerByUrl[row.key] || [];
      const headerDirectives = headers.reduce(function (combined, header) {
        return combined.concat(header.directives);
      }, []);

      if (!Object.keys(row.directives).length) {
        parseSummary.push(label + " has no robots, googlebot, or bingbot meta directive in the pasted snippet.");
      }

      if (expectsIndex && (hasDirective(allDirectives, "noindex") || hasDirective(headerDirectives, "noindex"))) {
        noindexWarnings.push(label + " is intended to be indexable but contains `noindex` in meta robots or X-Robots-Tag.");
      }
      if (expectsIndex && isStagingLike(label)) {
        noindexWarnings.push(label + " looks like a staging, preview, test, QA, draft, or localhost URL inside an indexable launch set.");
      }
      if (hasDirective(allDirectives, "nofollow") || hasDirective(headerDirectives, "nofollow")) {
        snippetWarnings.push(label + " includes `nofollow`; confirm link-following restrictions are intentional.");
      }
      ["nosnippet", "noarchive", "max-snippet"].forEach(function (directive) {
        if (hasDirective(allDirectives, directive) || hasDirective(headerDirectives, directive)) {
          snippetWarnings.push(label + " includes `" + directive + "`; confirm search preview restrictions are intentional.");
        }
      });

      if (googlebot.length && bingbot.length) {
        ["index", "noindex", "follow", "nofollow", "nosnippet"].forEach(function (directive) {
          if (hasDirective(googlebot, directive) !== hasDirective(bingbot, directive)) {
            botConflictWarnings.push(label + " has bot-specific disagreement for `" + directive + "` between googlebot and bingbot.");
          }
        });
      }
      if (generic.length && (googlebot.length || bingbot.length)) {
        ["noindex", "nofollow", "nosnippet", "noarchive"].forEach(function (directive) {
          if (hasDirective(generic, directive) !== (hasDirective(googlebot, directive) || hasDirective(bingbot, directive))) {
            botConflictWarnings.push(label + " has generic robots vs bot-specific disagreement for `" + directive + "`.");
          }
        });
      }

      headers.forEach(function (header) {
        if (hasDirective(header.directives, "noindex") && !mapHas(row.directives, "noindex")) {
          headerConflictWarnings.push(label + " has X-Robots-Tag `noindex` without matching page-level meta robots `noindex`.");
        }
        if (mapHas(row.directives, "noindex") && hasDirective(header.directives, "index")) {
          headerConflictWarnings.push(label + " has meta robots `noindex` but X-Robots-Tag says `index`.");
        }
        if (hasDirective(header.directives, "nosnippet") && !mapHas(row.directives, "nosnippet")) {
          headerConflictWarnings.push(label + " has X-Robots-Tag `nosnippet` without matching page-level snippet intent.");
        }
      });

      if (isBlockedByRobots(label, disallows)) {
        accessReminders.push(label + " matches a robots.txt Disallow rule; crawlers may not be able to see page-level meta robots directives.");
      }
    });

    headerRows.forEach(function (row) {
      if (!headRows.some(function (headRow) { return headRow.key === row.key; })) {
        if (expectsIndex && hasDirective(row.directives, "noindex")) {
          noindexWarnings.push(row.url + " has X-Robots-Tag `noindex` and no matching head row in the pasted launch set.");
        }
        if (hasDirective(row.directives, "nosnippet") || hasDirective(row.directives, "noarchive") || hasDirective(row.directives, "max-snippet")) {
          snippetWarnings.push(row.url + " has restrictive X-Robots-Tag preview/cache directives.");
        }
      }
    });

    if (!clean(input.robotsNotes)) {
      accessReminders.push("No robots.txt notes were provided, so crawler access conflicts could not be checked.");
    }
    if (/migration|cms|template|staging/i.test(input.launchContext)) {
      accessReminders.push("For " + clean(input.launchContext).toLowerCase() + ", verify production templates and CDN headers after release freeze.");
    }

    const issueCount =
      noindexWarnings.length +
      snippetWarnings.length +
      botConflictWarnings.length +
      headerConflictWarnings.length +
      accessReminders.filter(function (item) { return /matches a robots\.txt|No robots\.txt/i.test(item); }).length +
      (headRows.length ? 0 : 1);
    const status = noindexWarnings.length || headerConflictWarnings.length
      ? "Fix before launch"
      : botConflictWarnings.length || snippetWarnings.length
        ? "Manual review"
        : "Ready for final robots check";

    return {
      status: status,
      issueCount: issueCount,
      headRowCount: headRows.length,
      headerRowCount: headerRows.length,
      disallowCount: disallows.length,
      launchContext: clean(input.launchContext),
      launchIntent: launchIntent,
      parseSummary: Array.from(new Set(parseSummary)),
      noindexWarnings: Array.from(new Set(noindexWarnings)),
      snippetWarnings: Array.from(new Set(snippetWarnings)),
      botConflictWarnings: Array.from(new Set(botConflictWarnings)),
      headerConflictWarnings: Array.from(new Set(headerConflictWarnings)),
      accessReminders: Array.from(new Set(accessReminders)),
    };
  }

  function briefToText(brief) {
    return [
      "Meta Robots Conflict QA Briefs",
      "Status: " + brief.status,
      "Issue count: " + brief.issueCount,
      "URL/head rows: " + brief.headRowCount,
      "X-Robots-Tag rows: " + brief.headerRowCount,
      "robots.txt Disallow rules: " + brief.disallowCount,
      "Launch context: " + brief.launchContext,
      "Launch intent: " + brief.launchIntent,
      "",
      "Parse summary:",
      brief.parseSummary.length ? brief.parseSummary.join("\n") : "None found.",
      "",
      "Noindex launch warnings:",
      brief.noindexWarnings.length ? brief.noindexWarnings.join("\n") : "None found.",
      "",
      "Nofollow, snippet, cache, and preview warnings:",
      brief.snippetWarnings.length ? brief.snippetWarnings.join("\n") : "None found.",
      "",
      "Bot-specific directive conflicts:",
      brief.botConflictWarnings.length ? brief.botConflictWarnings.join("\n") : "None found.",
      "",
      "X-Robots-Tag vs meta robots disagreements:",
      brief.headerConflictWarnings.length ? brief.headerConflictWarnings.join("\n") : "None found.",
      "",
      "robots.txt access reminders:",
      brief.accessReminders.join("\n"),
      "",
      "Note: This is launch QA guidance, not a guarantee of indexing, crawling, or snippet outcomes.",
    ].join("\n");
  }

  function renderBrief(brief) {
    const output = qs("#brief-output");
    const copyButton = qs("#copy-brief");
    const outputPanel = qs(".output-panel");
    const statusPill = qs("#status-pill");
    if (!output) return;

    output.classList.remove("empty");
    output.classList.add("is-updated");
    window.setTimeout(function () { output.classList.remove("is-updated"); }, 480);
    output.innerHTML = [
      '<div class="brief-summary">',
      '<strong>' + escapeHtml(brief.status) + '</strong>',
      '<span>' + brief.issueCount + ' checks need attention across ' + brief.headRowCount + ' URL/head rows</span>',
      "</div>",
      '<section class="brief-section"><h4>Parse summary</h4>' + listHtml(brief.parseSummary, "No parse notes found.") + "</section>",
      '<section class="brief-section"><h4>Noindex launch warnings</h4>' + listHtml(brief.noindexWarnings, "No noindex warnings found for the selected launch intent.") + "</section>",
      '<section class="brief-section"><h4>Nofollow, snippet, cache, and preview warnings</h4>' + listHtml(brief.snippetWarnings, "No restrictive follow/snippet/cache directives found.") + "</section>",
      '<section class="brief-section"><h4>Bot-specific directive conflicts</h4>' + listHtml(brief.botConflictWarnings, "No googlebot/bingbot/generic robots conflicts found.") + "</section>",
      '<section class="brief-section"><h4>X-Robots-Tag vs meta robots disagreements</h4>' + listHtml(brief.headerConflictWarnings, "No X-Robots-Tag vs meta robots disagreement found.") + "</section>",
      '<section class="brief-section"><h4>robots.txt access reminders</h4>' + listHtml(brief.accessReminders, "No robots.txt access reminders found.") + "</section>",
    ].join("");
    setText("#output-title", "Robots directive conflict QA brief ready");
    setText("#status-pill", brief.status);
    if (copyButton) copyButton.disabled = false;
    if (outputPanel) {
      outputPanel.classList.add("has-brief");
      outputPanel.classList.toggle("status-good", brief.status === "Ready for final robots check");
      outputPanel.classList.toggle("status-warning", brief.status === "Manual review");
      outputPanel.classList.toggle("status-danger", brief.status === "Fix before launch");
    }
    if (statusPill) {
      statusPill.classList.toggle("status-good", brief.status === "Ready for final robots check");
      statusPill.classList.toggle("status-warning", brief.status === "Manual review");
      statusPill.classList.toggle("status-danger", brief.status === "Fix before launch");
    }
    state.latestBrief = brief;
    state.latestBriefText = briefToText(brief);
  }

  function pulseClass(element, className, duration) {
    if (!element) return;
    element.classList.add(className);
    window.setTimeout(function () { element.classList.remove(className); }, duration || 600);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall through to textarea fallback for headless browser clipboard blocks.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setupAuditor() {
    const form = qs("#auditor-form");
    const headInput = qs("#head-input");
    const headerInput = qs("#header-input");
    const robotsInput = qs("#robots-input");
    const loadSample = qs("#load-sample");
    const error = qs("#workflow-error");
    const copyButton = qs("#copy-brief");
    if (!form || !headInput) return;

    if (loadSample) {
      loadSample.addEventListener("click", function () {
        headInput.value = SAMPLE_HEAD_ROWS;
        if (headerInput) headerInput.value = SAMPLE_HEADER_ROWS;
        if (robotsInput) robotsInput.value = SAMPLE_ROBOTS_NOTES;
        if (qs("#launch-context")) qs("#launch-context").value = "Site migration";
        if (qs("#launch-intent")) qs("#launch-intent").value = "Indexable launch pages";
        headInput.focus();
        pulseClass(loadSample, "is-confirmed", 520);
        track("sample_robots_rows_loaded");
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      track("core_action_started", { triggerSource: "auditor_form" });
      if (error) error.textContent = "";

      const input = {
        headRows: headInput.value.trim(),
        headerRows: headerInput ? headerInput.value.trim() : "",
        robotsNotes: robotsInput ? robotsInput.value.trim() : "",
        launchContext: qs("#launch-context") ? qs("#launch-context").value : "",
        launchIntent: qs("#launch-intent") ? qs("#launch-intent").value : "",
      };
      const inputLength = Object.keys(input).reduce(function (total, key) { return total + String(input[key]).length; }, 0);
      if (!input.headRows) {
        if (error) error.textContent = "Paste URL/head rows or load the sample before generating a robots directive conflict QA brief.";
        track("core_action_failed", { reason: "empty_input" });
        return;
      }

      const brief = analyzeRobots(input);
      renderBrief(brief);
      track("core_action_completed", {
        issueCount: brief.issueCount,
        status: brief.status,
        headRowCount: brief.headRowCount,
        headerRowCount: brief.headerRowCount,
        inputLength: inputLength,
      });
    });

    if (copyButton) {
      copyButton.addEventListener("click", function () {
        if (!state.latestBriefText) return;
        copyText(state.latestBriefText).then(function () {
          copyButton.textContent = "Copied brief";
          pulseClass(copyButton, "is-confirmed", 700);
          track("brief_copied", { issueCount: state.latestBrief ? state.latestBrief.issueCount : 0 });
          window.setTimeout(function () { copyButton.textContent = "Copy brief"; }, 1400);
        });
      });
    }
  }

  function buildRemoteIssue(intent) {
    const body = [
      "Meta Robots Conflict QA Briefs early-access request",
      "",
      "Role: " + intent.role,
      "Number of sites: " + intent.siteCount,
      "Launch context: " + intent.launchContext,
      "Plan interest: " + intent.plan,
      "Willingness to pay: " + intent.budget,
      "Purchase intent: " + (intent.purchaseIntent ? "yes" : "no"),
      "",
      "Biggest robots QA pain:",
      intent.pain,
      "",
      "Note: Email is intentionally omitted from this public issue body.",
    ].join("\n");
    state.lastRemoteBody = body;
    const params = new URLSearchParams({
      title: "Meta Robots Conflict QA Briefs early-access request",
      body: body,
      labels: "early-access,purchase-intent,demo-request",
      template: "demo_request.md",
    });
    return GITHUB_ISSUE_URL + "?" + params.toString();
  }

  function setupWaitlist() {
    const form = qs("#waitlist-form");
    const status = qs("#waitlist-status");
    const handoff = qs("#handoff-panel");
    const remoteLink = qs("#remote-intent-link");
    const copyRequest = qs("#copy-request");
    const planSelect = qs("#plan");
    if (!form) return;

    form.addEventListener("focusin", function () {
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_form" });
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_submit" });
      }
      const intent = {
        email: qs("#email") ? qs("#email").value.trim() : "",
        role: qs("#role") ? qs("#role").value : "",
        siteCount: qs("#site-count") ? qs("#site-count").value : "",
        launchContext: qs("#launch-context-intent") ? qs("#launch-context-intent").value : "",
        plan: planSelect ? planSelect.value : "",
        budget: qs("#budget") ? qs("#budget").value : "",
        pain: qs("#pain") ? qs("#pain").value.trim() : "",
        purchaseIntent: qs("#purchase-intent") ? qs("#purchase-intent").checked : false,
        createdAt: new Date().toISOString(),
        utm: getUtm(),
      };
      const intents = readArray(INTENT_KEY);
      intents.push(intent);
      writeArray(INTENT_KEY, intents.slice(-100));

      const remoteHref = buildRemoteIssue(intent);
      if (remoteLink) remoteLink.href = remoteHref;
      if (handoff) {
        handoff.hidden = false;
        pulseClass(handoff, "is-confirmed", 700);
      }
      if (status) status.textContent = "You are on the early access list. Public-safe request details are ready.";

      track("waitlist_submitted", { role: intent.role, plan: intent.plan, siteCount: intent.siteCount });
      track("feedback_submitted", { triggerSource: "waitlist_form", painLength: intent.pain.length });
      track("remote_intent_ready", { hasRemoteLink: Boolean(remoteHref) });
      if (intent.purchaseIntent) track("checkout_intent", { plan: intent.plan, budget: intent.budget });
    });

    if (copyRequest) {
      copyRequest.addEventListener("click", function () {
        if (!state.lastRemoteBody) return;
        copyText(state.lastRemoteBody).then(function () {
          copyRequest.textContent = "Copied request details";
          pulseClass(copyRequest, "is-confirmed", 700);
          track("remote_intent_copied", { bodyLength: state.lastRemoteBody.length });
          window.setTimeout(function () { copyRequest.textContent = "Copy request details"; }, 1500);
        });
      });
    }
  }

  function setupPlanButtons() {
    const waitlist = qs("#waitlist");
    const planSelect = qs("#plan");
    qsa(".plan-button").forEach(function (button) {
      button.addEventListener("click", function () {
        const plan = button.getAttribute("data-plan") || "";
        if (planSelect && plan) planSelect.value = plan;
        track("pricing_viewed", { triggerSource: "plan_button" });
        state.pricingTracked = true;
        track("checkout_started", { plan: plan, triggerSource: "pricing_button" });
        pulseClass(button, "is-confirmed", 500);
        if (waitlist) waitlist.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function setupTracking() {
    track("landing_viewed", { product: "Meta Robots Conflict QA Briefs" });
    qsa("[data-track-cta]").forEach(function (element) {
      element.addEventListener("click", function () {
        track("cta_clicked", { cta: element.getAttribute("data-track-cta") || element.textContent.trim() });
      });
    });
    const pricing = qs("#pricing");
    if (pricing && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !state.pricingTracked) {
            state.pricingTracked = true;
            track("pricing_viewed", { triggerSource: "scroll" });
            observer.disconnect();
          }
        });
      }, { threshold: 0.35 });
      observer.observe(pricing);
    }
  }

  function setupChrome() {
    const header = qs("[data-header]");
    if (!header) return;
    function updateHeader() {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  function setupReveal() {
    const elements = qsa(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach(function (element) { observer.observe(element); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupTracking();
    setupChrome();
    setupReveal();
    setupAuditor();
    setupWaitlist();
    setupPlanButtons();
  });
}());
