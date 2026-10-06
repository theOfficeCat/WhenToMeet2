(function () {
  "use strict";

  const ev = JSON.parse(document.getElementById("event-data").textContent);
  const grid = document.getElementById("grid");
  const gridWrap = grid.parentElement;
  const nameInput = document.getElementById("name");
  const statusEl = document.getElementById("status");
  const saveBtn = document.getElementById("save");
  const clearBtn = document.getElementById("clear");

  const CELL_CLASS = { 2: "yes", 1: "maybe", 0: "no" };
  const state = new Map();
  const cellGrid = [];
  let brush = 2;
  let painting = false;
  let dirty = false;
  let loadTimer = null;
  let anchor = null;
  let hoverCol = null;
  let hoverRow = null;
  let strokeValue = null;

  const previewBox = document.createElement("div");
  previewBox.className = "rect-preview";
  gridWrap.appendChild(previewBox);

  function cellKey(day, slot) {
    return day + "|" + slot;
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function markDirty() {
    dirty = true;
    setStatus("");
  }

  function buildGrid() {
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "corner";
    corner.textContent = "Time";
    headRow.appendChild(corner);
    for (const day of ev.days) {
      const th = document.createElement("th");
      th.className = "day-head";
      th.textContent = day.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    grid.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const slot of ev.slots) {
      const rowCells = [];
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.className = "time-head";
      th.textContent = slot.label;
      tr.appendChild(th);
      for (let col = 0; col < ev.days.length; col++) {
        const day = ev.days[col];
        const td = document.createElement("td");
        td.className = "cell";
        td.dataset.day = day.date;
        td.dataset.slot = slot.index;
        td.dataset.col = col;
        td.addEventListener("pointerdown", onPointerDown);
        td.addEventListener("pointerenter", onPointerEnter);
        tr.appendChild(td);
        rowCells.push(td);
      }
      cellGrid.push(rowCells);
      tbody.appendChild(tr);
    }
    grid.appendChild(tbody);
  }

  function setCell(td, value) {
    const key = cellKey(td.dataset.day, Number(td.dataset.slot));
    const previous = state.get(key);
    if (value === -1) {
      if (previous === undefined) return false;
      state.delete(key);
      td.classList.remove("yes", "maybe", "no");
      return true;
    }
    if (previous === value) return false;
    state.set(key, value);
    td.classList.remove("yes", "maybe", "no");
    td.classList.add(CELL_CLASS[value]);
    return true;
  }

  function rectBounds(col, row) {
    return {
      c0: Math.min(anchor.col, col),
      c1: Math.max(anchor.col, col),
      r0: Math.min(anchor.row, row),
      r1: Math.max(anchor.row, row),
    };
  }

  function showPreview(col, row) {
    hoverCol = col;
    hoverRow = row;
    const bounds = rectBounds(col, row);
    const topLeft = cellGrid[bounds.r0][bounds.c0];
    const bottomRight = cellGrid[bounds.r1][bounds.c1];
    previewBox.style.left = topLeft.offsetLeft + "px";
    previewBox.style.top = topLeft.offsetTop + "px";
    previewBox.style.width =
      bottomRight.offsetLeft + bottomRight.offsetWidth - topLeft.offsetLeft + "px";
    previewBox.style.height =
      bottomRight.offsetTop + bottomRight.offsetHeight - topLeft.offsetTop + "px";
    previewBox.classList.toggle("erase", strokeValue === -1);
    previewBox.classList.add("visible");
  }

  function applyRect(col, row) {
    const bounds = rectBounds(col, row);
    let changed = false;
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      for (let c = bounds.c0; c <= bounds.c1; c++) {
        if (setCell(cellGrid[r][c], strokeValue)) changed = true;
      }
    }
    if (changed) markDirty();
  }

  function startStroke(td) {
    const col = Number(td.dataset.col);
    const row = Number(td.dataset.slot);
    const previous = state.get(cellKey(td.dataset.day, row));
    strokeValue = brush === -1 || previous === brush ? -1 : brush;
    anchor = { col: col, row: row };
    showPreview(col, row);
  }

  function finishStroke(commit) {
    if (!painting) return;
    painting = false;
    if (commit && anchor && hoverCol !== null) applyRect(hoverCol, hoverRow);
    anchor = null;
    hoverCol = null;
    hoverRow = null;
    strokeValue = null;
    previewBox.classList.remove("visible");
  }

  function hoverCell(td) {
    if (!painting) return;
    showPreview(Number(td.dataset.col), Number(td.dataset.slot));
  }

  function applyState(responses) {
    state.clear();
    for (const td of grid.querySelectorAll("td.cell")) {
      td.classList.remove("yes", "maybe", "no");
    }
    for (const [day, slots] of Object.entries(responses || {})) {
      for (const [slotStr, value] of Object.entries(slots)) {
        const slot = Number(slotStr);
        if (!(value in CELL_CLASS)) continue;
        state.set(cellKey(day, slot), value);
        const td = grid.querySelector(
          'td.cell[data-day="' + day + '"][data-slot="' + slot + '"]'
        );
        if (td) td.classList.add(CELL_CLASS[value]);
      }
    }
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    painting = true;
    startStroke(event.currentTarget);
    if (event.pointerId !== undefined && event.currentTarget.releasePointerCapture) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
    event.preventDefault();
  }

  function onPointerEnter(event) {
    hoverCell(event.currentTarget);
  }

  function hoverFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el && el.classList && el.classList.contains("cell")) hoverCell(el);
  }

  async function save() {
    const name = nameInput.value.trim();
    if (!name) {
      setStatus("Enter your name to save.", "error");
      nameInput.focus();
      return;
    }
    const responses = {};
    for (const [key, value] of state) {
      const parts = key.split("|");
      (responses[parts[0]] = responses[parts[0]] || {})[parts[1]] = value;
    }
    saveBtn.disabled = true;
    setStatus("Saving…");
    try {
      const res = await fetch("/api/e/" + ev.id + "/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, responses: responses }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save.");
      dirty = false;
      setStatus("Saved · " + state.size + " slot(s) marked.", "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function loadParticipant() {
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      const res = await fetch(
        "/api/e/" + ev.id + "/participant?name=" + encodeURIComponent(name)
      );
      if (!res.ok) return;
      const data = await res.json();
      if (nameInput.value.trim() !== name) return;
      if (data.found) {
        applyState(data.responses);
        dirty = false;
        setStatus(
          "Loaded your previous answer (" + state.size + " slot(s)).",
          "ok"
        );
      }
    } catch (_) {
      /* offline: painting can continue */
    }
  }

  document.querySelectorAll(".brush").forEach(function (btn) {
    btn.addEventListener("click", function () {
      brush = Number(btn.dataset.value);
      document.querySelectorAll(".brush").forEach(function (other) {
        other.classList.toggle("active", other === btn);
      });
    });
  });

  grid.addEventListener("pointermove", function (event) {
    if (painting) hoverFromPoint(event.clientX, event.clientY);
  });
  document.addEventListener("pointerup", function () {
    finishStroke(true);
  });
  document.addEventListener("pointercancel", function () {
    finishStroke(false);
  });

  nameInput.addEventListener("input", function () {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(loadParticipant, 500);
  });

  saveBtn.addEventListener("click", save);

  clearBtn.addEventListener("click", function () {
    if (!state.size) return;
    if (!window.confirm("Clear all your marks?")) return;
    applyState({});
    markDirty();
  });

  document.getElementById("copy-link").addEventListener("click", async function (event) {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(window.location.href);
      button.textContent = "Copied!";
      setTimeout(function () {
        button.textContent = "Copy link";
      }, 1500);
    } catch (_) {
      window.prompt("Copy the link:", window.location.href);
    }
  });

  window.addEventListener("beforeunload", function (event) {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  buildGrid();
  nameInput.focus();
})();
