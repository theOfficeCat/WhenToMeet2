(function () {
  "use strict";

  const ev = JSON.parse(document.getElementById("event-data").textContent);
  const table = document.getElementById("results-grid");
  const bestList = document.getElementById("best-list");
  const peopleList = document.getElementById("people-list");

  let maxScore = 0;

  function heatColor(ratio) {
    const lightness = 96 - 64 * ratio;
    return "hsl(125, 45%, " + lightness + "%)";
  }

  function formatMinutes(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function render(data) {
    maxScore = 0;
    for (const day of data.matrix) {
      for (const cell of day.cells) {
        if (cell.score > maxScore) maxScore = cell.score;
      }
    }

    table.textContent = "";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "corner";
    corner.textContent = "Time";
    headRow.appendChild(corner);
    for (const day of data.event.days) {
      const th = document.createElement("th");
      th.className = "day-head";
      th.textContent = day.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const slot of data.event.slots) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.className = "time-head";
      th.textContent = slot.label;
      tr.appendChild(th);
      for (const day of data.matrix) {
        const cell = day.cells[slot.index];
        const td = document.createElement("td");
        td.className = "cell heat";
        const ratio = maxScore > 0 ? cell.score / maxScore : 0;
        if (cell.score > 0) td.style.background = heatColor(ratio);
        if (maxScore > 0 && cell.score === maxScore) td.classList.add("best");
        if (ratio > 0.55) td.classList.add("dark");
        td.title =
          day.label + " " + slot.label + "\n" +
          "Yes: " + cell.yes + " · Maybe: " + cell.maybe + " · No: " + cell.no + "\n" +
          "Score: " + cell.score;
        if (cell.score > 0) td.textContent = cell.score;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    renderPeople(data.participants);
    renderBest(data);
  }

  function renderPeople(people) {
    peopleList.textContent = "";
    if (!people.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No one has responded yet.";
      peopleList.appendChild(li);
      return;
    }
    for (const person of people) {
      const li = document.createElement("li");
      li.textContent = person.name;
      peopleList.appendChild(li);
    }
  }

  function renderBest(data) {
    bestList.textContent = "";
    if (maxScore <= 0) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No responses yet to compute suggestions.";
      bestList.appendChild(li);
      return;
    }

    const runs = [];
    for (const day of data.matrix) {
      let start = null;
      for (let i = 0; i <= day.cells.length; i++) {
        const isBest = i < day.cells.length && day.cells[i].score === maxScore;
        if (isBest && start === null) start = i;
        if (!isBest && start !== null) {
          runs.push({ day: day.label, start: start, end: i - 1 });
          start = null;
        }
      }
    }

    runs.sort(function (a, b) {
      return b.end - b.start - (a.end - a.start);
    });

    for (const run of runs.slice(0, 6)) {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = run.day;
      li.appendChild(strong);
      const startMin = data.event.start_hour * 60 + run.start * data.event.slot_minutes;
      const endMin =
        data.event.start_hour * 60 + (run.end + 1) * data.event.slot_minutes;
      li.appendChild(
        document.createTextNode(
          ": " + formatMinutes(startMin) + "–" + formatMinutes(endMin) + " "
        )
      );
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "score " + maxScore;
      li.appendChild(badge);
      bestList.appendChild(li);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/e/" + ev.id + "/results");
      if (!res.ok) return;
      render(await res.json());
    } catch (_) {
      /* retry on the next cycle */
    }
  }

  refresh();
  setInterval(refresh, 10000);
})();
