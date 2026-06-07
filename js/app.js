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

/* ---------- Fixed document definitions (signature placements are constant) ---------- */
const DOCUMENTS = {
    service: {
        label: "Service Agreement",
        expectedFile: "JB Service Agreement 1.pdf",
        outputName: "JB Service Agreement 1 - Signed.pdf",
        pages: 10,
        signatures: [
            {
                id: "service-participant",
                role: "participant",
                label: "Participant / Representative",
                page: 9,
                x: 80,
                top: 360,
                width: 215,
                height: 32,
                date: { x: 170, top: 449, size: 10 }
            },
            {
                id: "service-arete",
                role: "arete",
                label: "Arete Authorised Person",
                page: 9,
                x: 80,
                top: 526,
                width: 215,
                height: 32,
                date: { x: 170, top: 621, size: 10 }
            }
        ],
        /* Tick boxes. Boxes sharing a `group` behave like radio buttons (one choice). */
        checkboxes: [
            // Section 11 — Auditor access (Yes/No)
            { id: "sa-auditor-yes", label: "Auditor access: Yes", page: 7, cx: 451.0, cy: 521.6, size: 8, group: "sa-auditor" },
            { id: "sa-auditor-no",  label: "Auditor access: No",  page: 7, cx: 493.1, cy: 521.6, size: 8, group: "sa-auditor" },
            // Section 11 — People who may access records (tick any)
            { id: "sa-support-coordinator", label: "Support Coordinator", page: 7, cx: 146.3, cy: 586.9, size: 8 },
            { id: "sa-plan-manager",        label: "Plan Manager",        page: 7, cx: 146.3, cy: 598.9, size: 8 },
            { id: "sa-school",              label: "School",              page: 7, cx: 146.3, cy: 611.7, size: 8 },
            { id: "sa-parents",             label: "Parents",             page: 7, cx: 146.3, cy: 623.7, size: 8 },
            { id: "sa-family-member",       label: "Family Member",       page: 7, cx: 146.3, cy: 636.4, size: 8 },
            { id: "sa-other-practitioners", label: "Other practitioners / Allied Health", page: 7, cx: 146.3, cy: 649.2, size: 8 },
            { id: "sa-other-list",          label: "Other",               page: 7, cx: 146.3, cy: 661.2, size: 8 },
            { id: "sa-offshore",            label: "Offshore Third-Party Contractors", page: 7, cx: 146.3, cy: 674.0, size: 8 },
            // Section 14 — Participant offered a copy (Yes/No)
            { id: "sa-copy-yes", label: "Offered a copy: Yes", page: 9, cx: 47.8, cy: 279.1, size: 8, group: "sa-copy" },
            { id: "sa-copy-no",  label: "Offered a copy: No",  page: 9, cx: 90.5, cy: 279.1, size: 8, group: "sa-copy" },
            // Section 14 — Explained verbally (Yes/No)
            { id: "sa-verbally-yes", label: "Explained verbally: Yes", page: 9, cx: 312.9, cy: 344.4, size: 8, group: "sa-verbally" },
            { id: "sa-verbally-no",  label: "Explained verbally: No",  page: 9, cx: 355.6, cy: 344.4, size: 8, group: "sa-verbally" }
        ],
        /* Fill-in blanks (the underlined spaces). */
        textFields: [
            { id: "sa-family-name",        label: "Family member name", page: 7, x: 270.8, top: 630.8, width: 250, height: 11, size: 9.5, linkedCheckbox: "sa-family-member" },
            { id: "sa-other-practitioner", label: "Other practitioner", page: 7, x: 370.4, top: 643.5, width: 148, height: 11, size: 9.5, linkedCheckbox: "sa-other-practitioners" },
            { id: "sa-other-list",         label: "Other (list)",       page: 7, x: 211.0, top: 655.6, width: 310, height: 11, size: 9.5, linkedCheckbox: "sa-other-list" }
        ]
    },
    schedule: {
        label: "Schedule of Supports",
        expectedFile: "JB Schedule of Support 1.pdf",
        outputName: "JB Schedule of Support 1 - Signed.pdf",
        pages: 2,
        signatures: [
            {
                id: "schedule-participant",
                role: "participant",
                label: "Participant / Representative",
                page: 2,
                x: 80,
                top: 326,
                width: 205,
                height: 32,
                date: { x: 284, top: 405, size: 10 }
            }
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

        if (pdf.numPages !== config.pages) {
            throw new Error(
                `This file has ${pdf.numPages} page(s), but the ${config.label} should have ${config.pages}. It looks like the wrong file — please upload the correct ${config.label} PDF.`
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
        .filter((signature) => signature.page === pageNumber)
        .forEach((signature) => wrapper.appendChild(createSignatureBox(signature)));

    (config.checkboxes || [])
        .filter((box) => box.page === pageNumber)
        .forEach((box) => wrapper.appendChild(createCheckboxOverlay(box)));

    (config.textFields || [])
        .filter((field) => field.page === pageNumber)
        .forEach((field) => wrapper.appendChild(createTextFieldOverlay(field)));

    pageScaleObserver.observe(wrapper);
    updatePageScale(wrapper);
}

function createCheckboxOverlay(box) {
    const pw = pageSizes[box.page];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "checkbox-overlay";
    el.dataset.checkbox = box.id;
    el.title = box.label;
    el.setAttribute("aria-label", box.label);
    // positioned at the box centre; CSS centres + sizes it responsively
    el.style.left = pct(box.cx, pw.width);
    el.style.top = pct(box.cy, pw.height);
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
    const pw = pageSizes[field.page];
    input.value = textValues[field.id] || "";
    input.style.left = pct(field.x, pw.width);
    input.style.top = pct(field.top, pw.height);
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
    const pw = pageSizes[signature.page];
    const box = document.createElement("button");
    box.type = "button";
    box.className = "signature-box";
    box.dataset.targetId = signature.id;
    box.style.left = pct(signature.x, pw.width);
    box.style.top = pct(signature.top, pw.height);
    box.style.width = pct(signature.width, pw.width);
    box.style.height = pct(signature.height, pw.height);
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

    const pw = pageSizes[target.page];
    const stamp = document.createElement("div");
    stamp.className = "date-stamp";
    stamp.dataset.dateTarget = target.id;
    stamp.textContent = formatDate(signedDate);
    stamp.style.left = pct(target.date.x, pw.width);
    stamp.style.top = pct(target.date.top, pw.height);
    stamp.style.fontSize = `calc(var(--s, 1) * ${target.date.size}px)`;

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
        const page = pdfDoc.getPage(target.page - 1);
        const pageSize = pageSizes[target.page] || {
            width: page.getWidth(),
            height: page.getHeight()
        };
        const signature = appliedSignatures[target.id];
        const image = await pdfDoc.embedPng(signature.dataUrl);
        const placement = fitImageInBox(
            image.width,
            image.height,
            target.x,
            fromTop(pageSize.height, target.top, target.height),
            target.width,
            target.height
        );

        page.drawImage(image, placement);
        drawFieldText(page, font, pageSize.height, target.date, formatDate(signature.signedDate));
    }

    // Ticked checkboxes
    for (const box of config.checkboxes || []) {
        if (!checkedBoxes[box.id]) continue;
        const page = pdfDoc.getPage(box.page - 1);
        const pageSize = pageSizes[box.page] || { width: page.getWidth(), height: page.getHeight() };
        drawCheckMark(page, pageSize.height, box);
    }

    // Filled text fields
    for (const field of config.textFields || []) {
        const value = (textValues[field.id] || "").trim();
        if (!value) continue;
        const page = pdfDoc.getPage(field.page - 1);
        const pageSize = pageSizes[field.page] || { width: page.getWidth(), height: page.getHeight() };
        page.drawText(value, {
            x: field.x + 2,
            y: fromTop(pageSize.height, field.top, field.height) + 1.5,
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
    const cx = box.cx;
    const cy = pageHeight - box.cy; // to bottom-origin
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
