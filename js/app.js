pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

const RENDER_SCALE = 1.6; // canvas render resolution; display size is responsive via CSS
const SIGNATURE_PAD_HEIGHT = 200;

/* Overlays are positioned as a % of the page so they stay aligned at any width.
   A per-page --s variable (display px per PDF point) scales overlay fonts. */
function pct(value, total) {
    return `${(value / total) * 100}%`;
}

// Today's date as yyyy-mm-dd in the user's local timezone (for the date input).
function todayIso() {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

const pageScaleObserver = new ResizeObserver((entries) => {
    for (const entry of entries) updatePageScale(entry.target);
});

function updatePageScale(wrapper) {
    const pw = parseFloat(wrapper.dataset.pageWidth);
    if (pw) wrapper.style.setProperty("--s", wrapper.clientWidth / pw);
}

/* ---------- Document definitions (anchor-based, reflow-proof) ----------
   Every field is positioned relative to a unique line of text (its `anchor`)
   rather than a fixed page/coordinate. At upload we find the anchor wherever it
   landed (any page, any vertical position) and place the field by its offset
   (dx, dy in PDF points) from the anchor line's left/baseline. This survives the
   document being regenerated with more/fewer pages or reflowed content.
   Offsets were calibrated from the reference PDFs; see anchor-field-coordinates memo. */
const DOCUMENTS = {
    service: {
        label: "Service Agreement",
        expectedFile: "JB Service Agreement 1.pdf",
        outputName: "JB Service Agreement 1 - Signed.pdf",
        signatures: [
            {
                // NOTE: this anchor line has leading spaces; pdf.js reports it from the
                // first visible glyph (~18pt right of PyMuPDF), so dx is calibrated to that.
                id: "service-participant", role: "participant", label: "Participant / Representative",
                anchor: "Signature of Participant", dx: -16.9, dy: -52.1, width: 215, height: 32,
                date: { cdx: 90.4, dy: 36.9, size: 10 }
            },
            {
                id: "service-arete", role: "arete", label: "Arete Authorised Person",
                anchor: "Signature of authorised person", dx: 1.2, dy: -51.3, width: 215, height: 32,
                date: { cdx: 108.5, dy: 43.7, size: 10 }
            }
        ],
        /* Tick boxes. Boxes sharing a `group` behave like radio buttons (one choice). */
        checkboxes: [
            // Section 11 — access list (all anchored to the section heading, a rigid block)
            { id: "sa-auditor-yes", label: "Auditor access: Yes", anchor: "Access to Records", dx: 378.9, dy: 18.6, size: 8, group: "sa-auditor" },
            { id: "sa-auditor-no",  label: "Auditor access: No",  anchor: "Access to Records", dx: 421.0, dy: 18.6, size: 8, group: "sa-auditor" },
            { id: "sa-support-coordinator", label: "Support Coordinator", anchor: "Access to Records", dx: 74.2, dy: 83.9, size: 8 },
            { id: "sa-plan-manager",        label: "Plan Manager",        anchor: "Access to Records", dx: 74.2, dy: 95.9, size: 8 },
            { id: "sa-school",              label: "School",              anchor: "Access to Records", dx: 74.2, dy: 108.7, size: 8 },
            { id: "sa-parents",             label: "Parents",             anchor: "Access to Records", dx: 74.2, dy: 120.7, size: 8 },
            { id: "sa-family-member",       label: "Family Member",       anchor: "Access to Records", dx: 74.2, dy: 133.4, size: 8 },
            { id: "sa-other-practitioners", label: "Other practitioners / Allied Health", anchor: "Access to Records", dx: 74.2, dy: 146.2, size: 8 },
            { id: "sa-other-list",          label: "Other",               anchor: "Access to Records", dx: 74.2, dy: 158.2, size: 8 },
            { id: "sa-offshore",            label: "Offshore Third-Party Contractors", anchor: "Access to Records", dx: 74.2, dy: 171.0, size: 8 },
            // Section 14 — offered a copy / explained verbally (Yes/No)
            { id: "sa-copy-yes", label: "Offered a copy: Yes", anchor: "once completed", dx: 4.3, dy: 17.9, size: 8, group: "sa-copy" },
            { id: "sa-copy-no",  label: "Offered a copy: No",  anchor: "once completed", dx: 47.0, dy: 17.9, size: 8, group: "sa-copy" },
            { id: "sa-verbally-yes", label: "Explained verbally: Yes", anchor: "explained verbally", dx: 234.1, dy: -3.9, size: 8, group: "sa-verbally" },
            { id: "sa-verbally-no",  label: "Explained verbally: No",  anchor: "explained verbally", dx: 276.8, dy: -3.9, size: 8, group: "sa-verbally" }
        ],
        /* Fill-in blanks (the underlined spaces). */
        textFields: [
            { id: "sa-family-name",        label: "Family member name", anchor: "Access to Records", dx: 198.7, dy: 127.8, width: 250, height: 11, size: 9.5, linkedCheckbox: "sa-family-member" },
            { id: "sa-other-practitioner", label: "Other practitioner", anchor: "Access to Records", dx: 298.3, dy: 140.5, width: 148, height: 11, size: 9.5, linkedCheckbox: "sa-other-practitioners" },
            { id: "sa-other-list-tf",      label: "Other (list)",       anchor: "Access to Records", dx: 138.9, dy: 152.6, width: 310, height: 11, size: 9.5, linkedCheckbox: "sa-other-list" }
        ]
    },
    schedule: {
        label: "Schedule of Supports",
        expectedFile: "JB Schedule of Support 1.pdf",
        outputName: "JB Schedule of Support 1 - Signed.pdf",
        signatures: [
            {
                id: "schedule-participant", role: "participant", label: "Participant / Representative",
                anchor: "Signature of Participant", dx: -17.6, dy: -42.6, width: 205, height: 32,
                date: { cdx: 200.0, dy: 36.4, size: 10 }
            }
        ]
    },
    consent: {
        label: "Consent Form",
        expectedFile: "LP Consent Form 1.pdf",
        outputName: "LP Consent Form 1 - Signed.pdf",
        signatures: [
            {
                // fills its cell (col4 row1: 116.3-147.9), centred with ~2.4pt margins
                id: "consent-participant", role: "participant", label: "Participant",
                anchor: "Date:", dx: 322.2, dy: -99.9, width: 132, height: 27,
                date: { cdx: 154.7, dy: -9.5, size: 10 }
            },
            {
                // fills its (shorter) cell (col4 row2: 147.9-175.7), centred with ~2.4pt margins
                id: "consent-representative", role: "representative", label: "Representative",
                anchor: "Date:", dx: 322.2, dy: -68.2, width: 132, height: 23
            }
        ],
        /* "Use of Media" consent tick boxes (independent opt-ins), anchored to the heading. */
        checkboxes: [
            { id: "cf-give-communicate", label: "Give authority — communicate with the following", anchor: "Use of Media", dx: 12.1, dy: 24.9, size: 10 },
            { id: "cf-give-share",       label: "Give authority — take and share",                  anchor: "Use of Media", dx: 12.1, dy: 87.6, size: 10 },
            { id: "cf-sub-support",      label: "Support Coordinator",        anchor: "Use of Media", dx: 53.4, dy: 117.2, size: 10 },
            { id: "cf-sub-senior",       label: "Senior Care Coordinator",    anchor: "Use of Media", dx: 53.4, dy: 133.0, size: 10 },
            { id: "cf-sub-gp",           label: "General Practitioner",       anchor: "Use of Media", dx: 53.4, dy: 149.1, size: 10 },
            { id: "cf-sub-allied",       label: "Allied Health Professionals", anchor: "Use of Media", dx: 53.4, dy: 165.1, size: 10 },
            { id: "cf-sub-staff",        label: "Regular Assigned Staff",     anchor: "Use of Media", dx: 53.4, dy: 181.6, size: 10 },
            { id: "cf-sub-ndis",         label: "NDIS",                       anchor: "Use of Media", dx: 53.4, dy: 197.5, size: 10 },
            { id: "cf-ng-therapeutic",   label: "Do not give — therapeutic purposes", anchor: "Use of Media", dx: 12.1, dy: 243.7, size: 10 },
            { id: "cf-ng-marketing",     label: "Do not give — marketing purposes",   anchor: "Use of Media", dx: 11.2, dy: 273.0, size: 10 },
            { id: "cf-ng-newsletter",    label: "Do not give — newsletter",           anchor: "Use of Media", dx: 11.1, dy: 303.9, size: 10 },
            { id: "cf-ng-contact",       label: "Do not give — contact me",           anchor: "Use of Media", dx: 11.0, dy: 336.1, size: 10 }
        ]
    }
};

/* ---------- State ---------- */
let activeDocumentKey = "";
let activeTargetId = "";
let activeBox = null;
let loadedPdfBytes = null;
let pageSizes = {};
let appliedSignatures = {};
let checkedBoxes = {};
let textValues = {};

/* ---------- Elements ---------- */
const modeModal = document.getElementById("modeModal");
const stepper = document.getElementById("stepper");
const docToolbar = document.getElementById("docToolbar");
const toolbarDocName = document.getElementById("toolbarDocName");
const toolbarMeta = document.getElementById("toolbarMeta");
const resetBtn = document.getElementById("resetBtn");
const uploadView = document.getElementById("uploadView");
const uploadZone = document.getElementById("uploadZone");
const uploadTitle = document.getElementById("uploadTitle");
const uploadError = document.getElementById("uploadError");
const fileInput = document.getElementById("fileInput");
const pdfContainer = document.getElementById("pdfContainer");
const emptyState = document.getElementById("emptyState");

const sidePanel = document.getElementById("sidePanel");
const panelLocked = document.getElementById("panelLocked");
const panelBody = document.getElementById("panelBody");
const panelMode = document.getElementById("panelMode");
const signerRoleSelect = document.getElementById("signerRole");
const signedDateInput = document.getElementById("signedDate");
const signatureCanvas = document.getElementById("signaturePad");
const signatureList = document.getElementById("signatureList");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const downloadBtn = document.getElementById("downloadBtn");
const fieldsHint = document.getElementById("fieldsHint");

const signaturePad = new SignaturePad(signatureCanvas, {
    backgroundColor: "rgba(255,255,255,0)",
    penColor: "#111827",
    minWidth: 1,
    maxWidth: 2.8,
    throttle: 8
});

/* ---------- Wiring ---------- */
modeModal.querySelectorAll(".mode-option").forEach((option) =>
    option.addEventListener("click", () => selectMode(option.dataset.mode))
);

document.getElementById("openModalBtn").addEventListener("click", openModeModal);
document.getElementById("changeDocBtn").addEventListener("click", openModeModal);
resetBtn.addEventListener("click", resetUpload);

uploadZone.addEventListener("click", () => fileInput.click());
uploadZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
    }
});
uploadZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragover");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragover");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) handleFile(file);
});
fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});

signerRoleSelect.addEventListener("change", selectFirstTargetForRole);
document.getElementById("clearSignature").addEventListener("click", () => signaturePad.clear());
document.getElementById("applySignature").addEventListener("click", applySignature);
downloadBtn.addEventListener("click", downloadSignedPdf);

window.addEventListener("resize", () => {
    if (panelBody.hidden === false) resizeSignatureCanvas();
});

init();

function init() {
    const documentKey = new URLSearchParams(window.location.search).get("document");
    if (DOCUMENTS[documentKey]) {
        selectMode(documentKey);
    } else {
        openModeModal();
    }
}

/* ---------- Mode selection ---------- */
function openModeModal() {
    modeModal.classList.add("open");
    modeModal.setAttribute("aria-hidden", "false");
}

function closeModeModal() {
    modeModal.classList.remove("open");
    modeModal.setAttribute("aria-hidden", "true");
}

function selectMode(key) {
    if (!DOCUMENTS[key]) return;

    activeDocumentKey = key;
    resetDocumentState();
    closeModeModal();

    const config = DOCUMENTS[key];

    // Show upload view, hide preview + empty state
    emptyState.hidden = true;
    pdfContainer.innerHTML = "";
    pdfContainer.hidden = true;
    uploadView.hidden = false;
    docToolbar.hidden = false;

    toolbarDocName.textContent = config.label;
    toolbarMeta.textContent = "Awaiting upload";
    resetBtn.hidden = true; // nothing to reset until a file is loaded
    uploadTitle.textContent = `Upload your ${config.label}`;
    hideUploadError();

    // Side panel locked until a file is loaded
    panelLocked.hidden = false;
    panelBody.hidden = true;
    panelMode.textContent = "Awaiting file";

    setStep("upload");
}

// Clear the current file (e.g. wrong document uploaded) and return to the upload
// screen for the SAME document type — no page reload needed.
function resetUpload() {
    if (!activeDocumentKey) return;

    const hasWork =
        Object.keys(appliedSignatures).length > 0 ||
        Object.values(checkedBoxes).some(Boolean) ||
        Object.values(textValues).some((value) => value && value.trim());

    if (hasWork && !confirm("Clear this file and start over? Your signatures and entries on this document will be discarded.")) {
        return;
    }

    selectMode(activeDocumentKey);
}

/* ---------- File handling ---------- */
async function handleFile(file) {
    hideUploadError();
    // Clear the input so the SAME file can be re-selected later (e.g. to retry
    // after an error, or after Reset). Without this the change event won't fire.
    fileInput.value = "";

    const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
        showUploadError("That doesn't look like a PDF. Please upload a .pdf file.");
        return;
    }

    const config = DOCUMENTS[activeDocumentKey];
    uploadTitle.textContent = `Loading ${file.name}...`;

    try {
        const buffer = await file.arrayBuffer();
        loadedPdfBytes = buffer;

        const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;

        // Locate every field by its text anchor (adapts to page count / reflow).
        const lineIndex = await buildLineIndex(pdf);
        const resolution = resolvePlacements(config, lineIndex);
        if (!resolution.ok) {
            throw new Error(
                `Couldn't find the expected fields in this PDF, so it looks like the wrong file or a changed format. Missing: ${resolution.missing.join(", ")}.`
            );
        }

        await renderAllPages(pdf, config);
        enterSigningMode(config, pdf.numPages);
    } catch (error) {
        console.error(error);
        loadedPdfBytes = null;
        uploadTitle.textContent = `Upload your ${config.label}`;
        showUploadError(error.message || "Could not read that PDF.");
    }
}

function showUploadError(message) {
    uploadError.textContent = message;
    uploadError.hidden = false;
}

function hideUploadError() {
    uploadError.hidden = true;
    uploadError.textContent = "";
}

/* ---------- Anchor resolution (reflow-proof placement) ---------- */

// Build, per page, a list of text lines with their left edge and baseline (in
// top-origin PDF points), grouping text items that share a baseline.
async function buildLineIndex(pdf) {
    const pages = {};

    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const groups = [];

        for (const item of content.items) {
            if (typeof item.str !== "string" || item.str.length === 0) continue;
            const x = item.transform[4];
            const f = item.transform[5]; // baseline, bottom-origin
            let group = groups.find((g) => Math.abs(g.f - f) < 2);
            if (!group) {
                group = { f, items: [] };
                groups.push(group);
            }
            group.items.push({ x, str: item.str });
        }

        pages[p] = groups.map((g) => {
            g.items.sort((a, b) => a.x - b.x);
            return {
                norm: g.items.map((i) => i.str).join("").replace(/\s+/g, "").toLowerCase(),
                startX: g.items[0].x,
                baselineTop: viewport.height - g.f
            };
        });
    }

    return pages;
}

// Find the (page, startX, baselineTop) of an anchor line, searching pages in order.
function findAnchorLine(lineIndex, anchor) {
    const key = anchor.replace(/\s+/g, "").toLowerCase();
    const pageNumbers = Object.keys(lineIndex).map(Number).sort((a, b) => a - b);
    for (const p of pageNumbers) {
        const line = lineIndex[p].find((l) => l.norm.includes(key));
        if (line) return { page: p, startX: line.startX, baselineTop: line.baselineTop };
    }
    return null;
}

// Resolve every field's actual (page, coords) from its anchor + offsets, storing
// the result on the field object as r* values used by rendering and download.
function resolvePlacements(config, lineIndex) {
    const missing = [];
    const cache = {};
    const locate = (anchor) => {
        if (!(anchor in cache)) cache[anchor] = findAnchorLine(lineIndex, anchor);
        return cache[anchor];
    };

    for (const s of config.signatures) {
        const a = locate(s.anchor);
        if (!a) { missing.push(s.anchor); continue; }
        s.rPage = a.page;
        s.rX = a.startX + s.dx;
        s.rTop = a.baselineTop + s.dy;
        if (s.date) {
            s.rDateCenterX = a.startX + s.date.cdx; // centre of the date underline
            s.rDateTop = a.baselineTop + s.date.dy;
        }
    }
    for (const c of config.checkboxes || []) {
        const a = locate(c.anchor);
        if (!a) { missing.push(c.anchor); continue; }
        c.rPage = a.page;
        c.rCx = a.startX + c.dx;
        c.rCy = a.baselineTop + c.dy;
    }
    for (const f of config.textFields || []) {
        const a = locate(f.anchor);
        if (!a) { missing.push(f.anchor); continue; }
        f.rPage = a.page;
        f.rX = a.startX + f.dx;
        f.rTop = a.baselineTop + f.dy;
    }

    return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

/* ---------- Rendering ---------- */
async function renderAllPages(pdf, config) {
    pdfContainer.innerHTML = "";
    pageSizes = {};

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        await renderPdfPage(pdf, config, pageNumber);
    }
}

async function renderPdfPage(pdf, config, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    pageSizes[pageNumber] = {
        width: viewport.width / RENDER_SCALE,
        height: viewport.height / RENDER_SCALE
    };

    const wrapper = document.createElement("div");
    wrapper.className = "page-wrapper";
    wrapper.dataset.page = pageNumber;
    wrapper.dataset.pageWidth = pageSizes[pageNumber].width;

    const badge = document.createElement("div");
    badge.className = "page-badge";
    badge.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
    wrapper.appendChild(badge);

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrapper.appendChild(canvas);

    pdfContainer.appendChild(wrapper);

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    config.signatures
        .filter((signature) => signature.rPage === pageNumber)
        .forEach((signature) => wrapper.appendChild(createSignatureBox(signature)));

    (config.checkboxes || [])
        .filter((box) => box.rPage === pageNumber)
        .forEach((box) => wrapper.appendChild(createCheckboxOverlay(box)));

    (config.textFields || [])
        .filter((field) => field.rPage === pageNumber)
        .forEach((field) => wrapper.appendChild(createTextFieldOverlay(field)));

    pageScaleObserver.observe(wrapper);
    updatePageScale(wrapper);
}

function createCheckboxOverlay(box) {
    const pw = pageSizes[box.rPage];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "checkbox-overlay";
    el.dataset.checkbox = box.id;
    el.title = box.label;
    el.setAttribute("aria-label", box.label);
    // positioned at the box centre; CSS centres + sizes it responsively
    el.style.left = pct(box.rCx, pw.width);
    el.style.top = pct(box.rCy, pw.height);
    el.classList.toggle("checked", Boolean(checkedBoxes[box.id]));
    el.addEventListener("click", () => toggleCheckbox(box, el));
    return el;
}

function toggleCheckbox(box, el) {
    const next = !checkedBoxes[box.id];

    if (next && box.group) {
        // radio behaviour within a group
        const config = getActiveConfig();
        config.checkboxes
            .filter((other) => other.group === box.group && other.id !== box.id)
            .forEach((other) => {
                checkedBoxes[other.id] = false;
                const otherEl = document.querySelector(`[data-checkbox="${other.id}"]`);
                if (otherEl) otherEl.classList.remove("checked");
            });
    }

    checkedBoxes[box.id] = next;
    el.classList.toggle("checked", next);
}

function createTextFieldOverlay(field) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "textfield-overlay";
    input.dataset.textfield = field.id;
    input.title = field.label;
    input.setAttribute("aria-label", field.label);
    const pw = pageSizes[field.rPage];
    input.value = textValues[field.id] || "";
    input.style.left = pct(field.rX, pw.width);
    input.style.top = pct(field.rTop, pw.height);
    input.style.width = pct(field.width, pw.width);
    input.style.height = `calc(var(--s, 1) * ${field.height + 4}px)`;
    input.style.fontSize = `calc(var(--s, 1) * ${field.size}px)`;
    input.addEventListener("input", () => {
        textValues[field.id] = input.value;
        // Typing into a blank auto-ticks its checkbox; clearing it unticks.
        if (field.linkedCheckbox) {
            setCheckboxChecked(field.linkedCheckbox, input.value.trim().length > 0);
        }
    });
    return input;
}

function setCheckboxChecked(id, state) {
    checkedBoxes[id] = state;
    const el = document.querySelector(`[data-checkbox="${id}"]`);
    if (el) el.classList.toggle("checked", state);
}

function createSignatureBox(signature) {
    const pw = pageSizes[signature.rPage];
    const box = document.createElement("button");
    box.type = "button";
    box.className = "signature-box";
    box.dataset.targetId = signature.id;
    box.style.left = pct(signature.rX, pw.width);
    box.style.top = pct(signature.rTop, pw.height);
    box.style.width = pct(signature.width, pw.width);
    box.style.height = pct(signature.height, pw.height);
    // Size the hint label to the box height so it fits short cells (e.g. consent form).
    const labelPt = Math.max(7, Math.min(11, signature.height * 0.6));
    box.style.fontSize = `calc(var(--s, 1) * ${labelPt.toFixed(1)}px)`;
    box.textContent = signature.label;
    box.addEventListener("click", () => selectTarget(signature.id, box));
    return box;
}

/* ---------- Enter signing mode ---------- */
function enterSigningMode(config, numPages) {
    uploadView.hidden = true;
    pdfContainer.hidden = false;
    emptyState.hidden = true;

    toolbarMeta.textContent = `${numPages} pages • ${config.signatures.length} signature${config.signatures.length > 1 ? "s" : ""} required`;
    resetBtn.hidden = false; // a file is loaded; allow re-upload

    // Populate signer role dropdown from this document's fields
    signerRoleSelect.innerHTML = config.signatures
        .map((signature) => `<option value="${signature.role}">${signature.label}</option>`)
        .join("");

    signedDateInput.value = todayIso(); // default to today; signer can change it

    const hasFields =
        (config.checkboxes && config.checkboxes.length) ||
        (config.textFields && config.textFields.length);
    fieldsHint.hidden = !hasFields;

    panelLocked.hidden = true;
    panelBody.hidden = false;
    panelMode.textContent = "Signing";

    resizeSignatureCanvas();
    selectFirstTargetForRole();
    renderSignatureList();
    updateProgress();
    setStep("sign");

    // Start at page 1 so the signer reviews the document top to bottom.
    pdfContainer.scrollIntoView({ behavior: "auto", block: "start" });
    const scroller = document.querySelector(".pdf-section");
    if (scroller) scroller.scrollTop = 0;
}

/* ---------- Target selection ---------- */
function selectFirstTargetForRole() {
    const config = getActiveConfig();
    if (!config) return;

    const role = signerRoleSelect.value;
    let target = config.signatures.find((signature) => signature.role === role);

    if (!target) {
        target = config.signatures[0];
        if (target) signerRoleSelect.value = target.role;
    }

    const box = target ? document.querySelector(`[data-target-id="${target.id}"]`) : null;
    if (target && box) selectTarget(target.id, box);
}

function selectTarget(targetId, box) {
    activeTargetId = targetId;
    activeBox = box;

    document
        .querySelectorAll(".signature-box")
        .forEach((element) => element.classList.toggle("active", element === box));

    const target = getTarget(targetId);
    if (target) {
        signerRoleSelect.value = target.role;
        panelMode.textContent = target.label;
    }
}

function selectTargetById(targetId) {
    const box = document.querySelector(`[data-target-id="${targetId}"]`);
    if (box) {
        selectTarget(targetId, box);
        scrollToTarget(targetId);
    }
}

function scrollToTarget(targetId) {
    const box = document.querySelector(`[data-target-id="${targetId}"]`);
    if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- Apply signature ---------- */
function applySignature() {
    const target = getTarget(activeTargetId);

    if (!target || !activeBox) {
        alert("Click a signature box first.");
        return;
    }

    if (!signedDateInput.value) {
        alert("Please pick the date signed before applying.");
        signedDateInput.focus();
        return;
    }

    if (signaturePad.isEmpty()) {
        alert("Please draw a signature.");
        return;
    }

    appliedSignatures[target.id] = {
        dataUrl: getTrimmedSignatureDataUrl(),
        signedDate: signedDateInput.value
    };

    activeBox.innerHTML = "";
    const img = document.createElement("img");
    img.alt = `${target.label} signature`;
    img.src = appliedSignatures[target.id].dataUrl;
    activeBox.appendChild(img);
    activeBox.classList.add("signed");

    renderDateStamp(target, appliedSignatures[target.id].signedDate);
    signaturePad.clear();

    renderSignatureList();
    updateProgress();
    goToNextPending();
}

function goToNextPending() {
    const config = getActiveConfig();
    if (!config) return;
    const next = config.signatures.find((signature) => !appliedSignatures[signature.id]);
    if (next) {
        selectTargetById(next.id);
        panelMode.textContent = next.label;
    } else {
        panelMode.textContent = "All signed";
    }
}

function renderDateStamp(target, signedDate) {
    if (!target.date || !activeBox) return;

    const wrapper = activeBox.closest(".page-wrapper");
    const existing = wrapper.querySelector(`[data-date-target="${target.id}"]`);
    if (existing) existing.remove();

    const pw = pageSizes[target.rPage];
    const stamp = document.createElement("div");
    stamp.className = "date-stamp";
    stamp.dataset.dateTarget = target.id;
    stamp.textContent = formatDate(signedDate);
    stamp.style.left = pct(target.rDateCenterX, pw.width);
    stamp.style.top = pct(target.rDateTop, pw.height);
    stamp.style.fontSize = `calc(var(--s, 1) * ${target.date.size}px)`;
    stamp.style.transform = "translateX(-50%)"; // centre on the underline

    wrapper.appendChild(stamp);
}

/* ---------- Progress + list ---------- */
function updateProgress() {
    const config = getActiveConfig();
    if (!config) return;

    const total = config.signatures.length;
    const done = config.signatures.filter((s) => appliedSignatures[s.id]).length;

    progressFill.style.width = total ? `${(done / total) * 100}%` : "0%";
    progressLabel.textContent = `${done} of ${total} signed`;

    const complete = done === total && total > 0;
    downloadBtn.disabled = !complete;
    if (complete) setStep("download");
    else if (!panelBody.hidden) setStep("sign");
}

function renderSignatureList() {
    const config = getActiveConfig();
    if (!config) {
        signatureList.innerHTML = "";
        return;
    }

    signatureList.innerHTML = config.signatures
        .map((signature) => {
            const done = Boolean(appliedSignatures[signature.id]);
            return `
                <button type="button" class="signature-item ${done ? "done" : ""}" data-list-target="${signature.id}">
                    <span>${signature.label}</span>
                    <strong>${done ? "Signed" : "Pending"}</strong>
                </button>
            `;
        })
        .join("");

    signatureList
        .querySelectorAll("[data-list-target]")
        .forEach((item) =>
            item.addEventListener("click", () => selectTargetById(item.dataset.listTarget))
        );
}

/* ---------- Download ---------- */
async function downloadSignedPdf() {
    const config = getActiveConfig();

    if (!config || !loadedPdfBytes) {
        alert("Upload a document first.");
        return;
    }

    const missing = config.signatures.filter((signature) => !appliedSignatures[signature.id]);
    if (missing.length) {
        alert(`Missing signature: ${missing[0].label}`);
        selectTargetById(missing[0].id);
        return;
    }

    const { PDFDocument, StandardFonts } = PDFLib;
    const pdfDoc = await PDFDocument.load(loadedPdfBytes.slice(0));
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const target of config.signatures) {
        const page = pdfDoc.getPage(target.rPage - 1);
        const pageSize = pageSizes[target.rPage] || {
            width: page.getWidth(),
            height: page.getHeight()
        };
        const signature = appliedSignatures[target.id];
        const image = await pdfDoc.embedPng(signature.dataUrl);
        const placement = fitImageInBox(
            image.width,
            image.height,
            target.rX,
            fromTop(pageSize.height, target.rTop, target.height),
            target.width,
            target.height
        );

        page.drawImage(image, placement);
        if (target.date) {
            const dateText = formatDate(signature.signedDate);
            const dateWidth = font.widthOfTextAtSize(dateText, target.date.size);
            drawFieldText(
                page, font, pageSize.height,
                { x: target.rDateCenterX - dateWidth / 2, top: target.rDateTop, size: target.date.size },
                dateText
            );
        }
    }

    // Ticked checkboxes
    for (const box of config.checkboxes || []) {
        if (!checkedBoxes[box.id]) continue;
        const page = pdfDoc.getPage(box.rPage - 1);
        const pageSize = pageSizes[box.rPage] || { width: page.getWidth(), height: page.getHeight() };
        drawCheckMark(page, pageSize.height, box);
    }

    // Filled text fields
    for (const field of config.textFields || []) {
        const value = (textValues[field.id] || "").trim();
        if (!value) continue;
        const page = pdfDoc.getPage(field.rPage - 1);
        const pageSize = pageSizes[field.rPage] || { width: page.getWidth(), height: page.getHeight() };
        page.drawText(value, {
            x: field.rX + 2,
            y: fromTop(pageSize.height, field.rTop, field.height) + 1.5,
            size: field.size,
            font,
            color: PDFLib.rgb(0, 0, 0)
        });
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = config.outputName;
    link.click();
    URL.revokeObjectURL(url);
}

function drawCheckMark(page, pageHeight, box) {
    const s = box.size || 8;
    const cx = box.rCx;
    const cy = pageHeight - box.rCy; // to bottom-origin
    const thickness = Math.max(1, s * 0.16);
    const color = PDFLib.rgb(0.05, 0.1, 0.2);

    const p1 = { x: cx - 0.38 * s, y: cy + 0.05 * s };
    const p2 = { x: cx - 0.10 * s, y: cy - 0.32 * s };
    const p3 = { x: cx + 0.42 * s, y: cy + 0.34 * s };

    page.drawLine({ start: p1, end: p2, thickness, color, lineCap: PDFLib.LineCapStyle.Round });
    page.drawLine({ start: p2, end: p3, thickness, color, lineCap: PDFLib.LineCapStyle.Round });
}

function drawFieldText(page, font, pageHeight, field, text) {
    if (!field || !text) return;
    page.drawText(text, {
        x: field.x,
        y: fromTop(pageHeight, field.top, field.size),
        size: field.size,
        font,
        color: PDFLib.rgb(0, 0, 0)
    });
}

/* ---------- Signature canvas helpers ---------- */
function resizeSignatureCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = signatureCanvas.offsetWidth || 320;
    const currentSignature = signaturePad.isEmpty() ? null : signaturePad.toData();

    signatureCanvas.width = width * ratio;
    signatureCanvas.height = SIGNATURE_PAD_HEIGHT * ratio;
    signatureCanvas.getContext("2d").scale(ratio, ratio);
    signaturePad.clear();

    if (currentSignature) signaturePad.fromData(currentSignature);
}

function getTrimmedSignatureDataUrl() {
    const sourceCanvas = signatureCanvas;
    const context = sourceCanvas.getContext("2d");
    const pixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const bounds = getInkBounds(pixels);

    if (!bounds) return signaturePad.toDataURL("image/png");

    const padding = 18;
    const left = Math.max(bounds.left - padding, 0);
    const top = Math.max(bounds.top - padding, 0);
    const right = Math.min(bounds.right + padding, sourceCanvas.width);
    const bottom = Math.min(bounds.bottom + padding, sourceCanvas.height);
    const width = right - left;
    const height = bottom - top;
    const trimmedCanvas = document.createElement("canvas");

    trimmedCanvas.width = width;
    trimmedCanvas.height = height;
    trimmedCanvas
        .getContext("2d")
        .drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);

    return trimmedCanvas.toDataURL("image/png");
}

function getInkBounds(imageData) {
    const { data, width, height } = imageData;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let foundInk = false;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha > 0) {
                foundInk = true;
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
            }
        }
    }

    return foundInk ? { left, top, right, bottom } : null;
}

function fitImageInBox(imageWidth, imageHeight, boxX, boxY, boxWidth, boxHeight) {
    const imageRatio = imageWidth / imageHeight;
    const boxRatio = boxWidth / boxHeight;
    let width = boxWidth;
    let height = boxHeight;

    if (imageRatio > boxRatio) {
        height = width / imageRatio;
    } else {
        width = height * imageRatio;
    }

    return {
        x: boxX + (boxWidth - width) / 2,
        y: boxY + (boxHeight - height) / 2,
        width,
        height
    };
}

function fromTop(pageHeight, top, height) {
    return pageHeight - top - height;
}

function formatDate(value) {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
}

/* ---------- Misc ---------- */
function resetDocumentState() {
    activeTargetId = "";
    activeBox = null;
    loadedPdfBytes = null;
    pageSizes = {};
    appliedSignatures = {};
    checkedBoxes = {};
    textValues = {};
    signaturePad.clear();
    pdfContainer.innerHTML = "";
    downloadBtn.disabled = true;
}

function setStep(step) {
    const order = ["document", "upload", "sign", "download"];
    const index = order.indexOf(step);
    stepper.querySelectorAll("li").forEach((li) => {
        const liIndex = order.indexOf(li.dataset.step);
        li.classList.toggle("active", liIndex === index);
        li.classList.toggle("done", liIndex < index);
    });
}

function getActiveConfig() {
    return activeDocumentKey ? DOCUMENTS[activeDocumentKey] : null;
}

function getTarget(targetId) {
    const config = getActiveConfig();
    return config ? config.signatures.find((signature) => signature.id === targetId) : null;
}
