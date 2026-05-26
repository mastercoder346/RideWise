/**
 * RideWise - Main Application Logic & Math Statistics Engine
 */

// --- STATE MANAGEMENT ---
let state = {
  cars: [],
  activeCarId: null,
  entries: {}, // Key: carId, Value: array of entry objects
  settings: {
    distanceUnit: 'miles',
    fuelUnit: 'gallons'
  }
};

// --- DEFAULT STATE INITIALIZATION ---
function loadData() {
  const savedState = localStorage.getItem('ridewise_state');
  if (savedState) {
    try {
      state = JSON.parse(savedState);
      if (!state.cars) state.cars = [];
      if (!state.entries) state.entries = {};
      if (!state.settings) state.settings = { distanceUnit: 'miles', fuelUnit: 'gallons' };
    } catch (e) {
      console.error("Error loading localStorage state:", e);
    }
  }
}

function saveData() {
  localStorage.setItem('ridewise_state', JSON.stringify(state));
}

// --- MATH & CALCULATION ENGINE ---
/**
 * Sorts entries by date and odometer reading
 */
function getSortedEntries(carId) {
  const list = state.entries[carId] || [];
  return [...list].sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    return a.odometer - b.odometer;
  });
}

/**
 * Filter entries to only get Fuel logs
 */
function getSortedFuelEntries(carId) {
  return getSortedEntries(carId).filter(e => !e.logType || e.logType === 'fuel');
}

/**
 * Calculates correct fuel economy intervals
 * Handles Partials by accumulating them up to the next Full fill-up.
 * Handles Missed by resetting accumulation baselines.
 */
function calculateEfficiencyForEntries(carId) {
  const sorted = getSortedFuelEntries(carId);
  if (sorted.length < 2) return sorted.map(e => ({ ...e, efficiency: null }));

  const results = [];
  let fuelAccumulator = 0;
  let startOdometer = null;
  let hasMissedInInterval = false;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const entryCopy = { ...entry, efficiency: null, distance: null };

    if (i === 0) {
      if (entry.fillType === 'full') {
        startOdometer = entry.odometer;
      }
      results.push(entryCopy);
      continue;
    }

    if (entry.fillType === 'missed') {
      fuelAccumulator = 0;
      startOdometer = entry.odometer;
      hasMissedInInterval = false;
      results.push(entryCopy);
      continue;
    }

    fuelAccumulator += entry.fuel;

    if (entry.fillType === 'full') {
      if (startOdometer !== null && !hasMissedInInterval) {
        const distance = entry.odometer - startOdometer;
        if (distance > 0) {
          let val = 0;
          if (state.settings.fuelUnit === 'liters' && state.settings.distanceUnit === 'kilometers') {
            val = (fuelAccumulator / distance) * 100;
          } else if (state.settings.fuelUnit === 'liters' && state.settings.distanceUnit === 'miles') {
            val = (fuelAccumulator / distance) * 100;
          } else {
            val = distance / fuelAccumulator;
          }
          entryCopy.efficiency = val;
          entryCopy.distance = distance;
        }
      }
      fuelAccumulator = 0;
      startOdometer = entry.odometer;
      hasMissedInInterval = false;
    } else {
      if (startOdometer === null) {
        hasMissedInInterval = true;
      }
    }

    results.push(entryCopy);
  }

  return results;
}

/**
 * Computes lifetime metrics
 */
function computeLifetimeStats(carId) {
  const allLogs = getSortedEntries(carId);
  const fuelOnly = getSortedFuelEntries(carId);
  const calculatedFuel = calculateEfficiencyForEntries(carId);

  if (!allLogs.length) {
    return { avgEco: null, totalCost: 0, lastOdo: 0, totalFuel: 0, totalDist: 0, avgPrice: 0, count: 0 };
  }

  const lastOdo = allLogs[allLogs.length - 1].odometer;
  const firstOdo = allLogs[0].odometer;

  let totalCost = 0;
  let totalFuel = 0;
  let fuelCost = 0;
  let validEcoSum = 0;
  let validEcoCount = 0;

  // Add fuel economy components
  calculatedFuel.forEach(e => {
    fuelCost += e.fuel * e.price;
    totalFuel += e.fuel;
    if (e.efficiency !== null) {
      validEcoSum += e.efficiency;
      validEcoCount++;
    }
  });

  // Sum up all general costs (fuel + maintenance)
  allLogs.forEach(e => {
    if (!e.logType || e.logType === 'fuel') {
      totalCost += e.fuel * e.price;
    } else if (e.logType === 'maintenance') {
      totalCost += e.cost;
    }
  });

  const avgEco = validEcoCount > 0 ? (validEcoSum / validEcoCount) : null;
  const avgPrice = totalFuel > 0 ? (fuelCost / totalFuel) : 0;
  const totalDist = lastOdo - firstOdo;

  return {
    avgEco,
    totalCost,
    lastOdo,
    totalFuel,
    totalDist,
    avgPrice,
    count: allLogs.length
  };
}

// --- DOM & NAVIGATION UI ENGINE ---
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initNav();
  initCarSelector();
  initModals();
  initSettings();
  initBackup();
  renderApp();
});

// View switching logic
function initNav() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      const targetView = item.getAttribute('data-view');
      document.querySelectorAll('.app-view').forEach(view => view.classList.remove('active'));
      
      const activeView = document.getElementById(`view-${targetView}`);
      if (activeView) {
        activeView.classList.add('active');
      }

      if (targetView === 'stats') {
        renderCharts();
      }
    });
  });

  document.getElementById('viewAllEntriesBtn').addEventListener('click', () => {
    const ledgerTab = document.querySelector('.nav-item[data-view="entries"]');
    if (ledgerTab) ledgerTab.click();
  });
}

// Initialize active car selectors
function initCarSelector() {
  const headerSelect = document.getElementById('headerActiveCar');
  headerSelect.addEventListener('change', (e) => {
    state.activeCarId = e.target.value;
    saveData();
    renderApp();
  });

  document.getElementById('quickAddEntryBtn').addEventListener('click', () => {
    openEntryModal();
  });
}

function updateCarDropdowns() {
  const headerSelect = document.getElementById('headerActiveCar');
  headerSelect.innerHTML = '';

  if (state.cars.length === 0) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = "No Cars Added";
    headerSelect.appendChild(opt);
    return;
  }

  state.cars.forEach(car => {
    const opt = document.createElement('option');
    opt.value = car.id;
    opt.textContent = `${car.year ? car.year + ' ' : ''}${car.name}`;
    if (car.id === state.activeCarId) {
      opt.selected = true;
    }
    headerSelect.appendChild(opt);
  });
}

// Geolocation Detector Helper
function detectLocation(prefillElement) {
  if (!navigator.geolocation) {
    console.warn("Geolocation is not supported by this browser.");
    return;
  }
  
  prefillElement.placeholder = "Locating Gas Station...";
  
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      
      try {
        // Querying at zoom=18 fetches building/node level entities (Gas Station brand names!)
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`);
        const data = await res.json();
        
        if (data) {
          const brand = data.name || (data.address && (data.address.fuel || data.address.amenity || data.address.shop)) || "";
          const city = data.address ? (data.address.city || data.address.town || data.address.village || data.address.county || "") : "";
          const stateName = data.address ? (data.address.state || "") : "";
          
          let resolvedText = "";
          if (brand) {
            // Remove redundant descriptions if present in Nominatim
            resolvedText += brand.replace(/\b(gas station|fuel)\b/gi, '').trim();
          }
          
          if (city) {
            if (resolvedText) resolvedText += ` - ${city}`;
            else resolvedText += city;
            
            if (stateName) {
              resolvedText += `, ${stateName}`;
            }
          }
          
          if (resolvedText) {
            prefillElement.value = resolvedText;
          } else {
            prefillElement.placeholder = "e.g. Shell - Austin, TX";
          }
        }
      } catch (err) {
        console.error("Geocoding failed:", err);
        prefillElement.placeholder = "Location geocoding failed";
      }
    },
    (error) => {
      console.warn("Geolocation permission error:", error);
      prefillElement.placeholder = "Location permission denied";
    },
    { timeout: 8000 }
  );
}

// Modal handling logic
function initModals() {
  document.getElementById('addCarBtn').addEventListener('click', () => openCarModal());
  document.getElementById('carModalClose').addEventListener('click', closeCarModal);
  document.getElementById('carModalCancel').addEventListener('click', closeCarModal);
  
  document.getElementById('addEntryBtn').addEventListener('click', () => openEntryModal());
  document.getElementById('emptyStateAddBtn').addEventListener('click', () => openEntryModal());
  document.getElementById('entryModalClose').addEventListener('click', closeEntryModal);
  document.getElementById('entryModalCancel').addEventListener('click', closeEntryModal);

  document.getElementById('detectLocBtn').addEventListener('click', () => {
    detectLocation(document.getElementById('entryLocation'));
  });

  // Form type changer (Fuel vs Maintenance)
  const logTypeSelect = document.getElementById('entryLogType');
  const fuelFields = document.getElementById('fuelFieldsGroup');
  const maintFields = document.getElementById('maintenanceFieldsGroup');

  logTypeSelect.addEventListener('change', () => {
    if (logTypeSelect.value === 'fuel') {
      fuelFields.style.display = 'block';
      maintFields.style.display = 'none';
      document.getElementById('entryFuel').setAttribute('required', 'true');
      document.getElementById('entryPrice').setAttribute('required', 'true');
      document.getElementById('entryMaintDesc').removeAttribute('required');
      document.getElementById('entryMaintCost').removeAttribute('required');
    } else {
      fuelFields.style.display = 'none';
      maintFields.style.display = 'block';
      document.getElementById('entryFuel').removeAttribute('required');
      document.getElementById('entryPrice').removeAttribute('required');
      document.getElementById('entryMaintDesc').setAttribute('required', 'true');
      document.getElementById('entryMaintCost').setAttribute('required', 'true');
    }
  });

  // Car form submit
  document.getElementById('carForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const indexStr = document.getElementById('carIndex').value;
    const name = document.getElementById('carName').value.trim();
    const make = document.getElementById('carMake').value.trim();
    const year = parseInt(document.getElementById('carYear').value) || null;

    if (indexStr === "") {
      const newCar = {
        id: 'car_' + Date.now(),
        name,
        make,
        year
      };
      state.cars.push(newCar);
      if (state.cars.length === 1) {
        state.activeCarId = newCar.id;
      }
    } else {
      const idx = parseInt(indexStr);
      if (state.cars[idx]) {
        state.cars[idx].name = name;
        state.cars[idx].make = make;
        state.cars[idx].year = year;
      }
    }
    saveData();
    closeCarModal();
    renderApp();
  });

  // Entry Form Type Description changer
  const fillTypeSelect = document.getElementById('entryFillType');
  const tipText = document.getElementById('tipText');
  fillTypeSelect.addEventListener('change', () => {
    const val = fillTypeSelect.value;
    if (val === 'full') {
      tipText.textContent = "Full Fill-up lets us calculate your exact efficiency (MPG / L/100km).";
    } else if (val === 'partial') {
      tipText.textContent = "Partial Fill-up tracks fuel volume but defers fuel economy stats to the next Full Fill-up.";
    } else if (val === 'missed') {
      tipText.textContent = "Missed Fill-up flags a gap in your odometer ledger so stats won't produce invalid spikes.";
    }
  });

  // Price auto-formatting cent-9 logic on blur
  const priceInput = document.getElementById('entryPrice');
  priceInput.addEventListener('blur', () => {
    let str = priceInput.value.trim();
    if (str === "") return;
    let val = parseFloat(str);
    if (!isNaN(val)) {
      const parts = str.split('.');
      if (parts.length === 2) {
        if (parts[1].length === 2) {
          priceInput.value = str + '9';
        } else if (parts[1].length === 1) {
          priceInput.value = str + '09';
        }
      } else if (parts.length === 1) {
        priceInput.value = str + '.009';
      }
    }
  });

  // Entry Form submit
  document.getElementById('entryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.activeCarId) {
      alert("Please add/select a car first!");
      return;
    }

    const indexStr = document.getElementById('entryIndex').value;
    const logType = logTypeSelect.value;
    const date = document.getElementById('entryDate').value;
    const odometer = parseInt(document.getElementById('entryOdometer').value);

    let entryObj = {
      id: indexStr === "" ? 'entry_' + Date.now() : undefined,
      logType,
      date,
      odometer
    };

    if (logType === 'fuel') {
      entryObj.fuel = parseFloat(document.getElementById('entryFuel').value);
      
      // Auto suffix with 9 if needed during submit
      let priceStr = document.getElementById('entryPrice').value.trim();
      let priceVal = parseFloat(priceStr);
      const parts = priceStr.split('.');
      if (parts.length === 2) {
        if (parts[1].length === 2) {
          priceVal = parseFloat(priceStr + '9');
        } else if (parts[1].length === 1) {
          priceVal = parseFloat(priceStr + '09');
        }
      } else if (parts.length === 1) {
        priceVal = parseFloat(priceStr + '.009');
      }
      
      entryObj.price = priceVal;
      entryObj.fillType = document.getElementById('entryFillType').value;
      entryObj.location = document.getElementById('entryLocation').value.trim();
    } else {
      entryObj.description = document.getElementById('entryMaintDesc').value.trim();
      entryObj.cost = parseFloat(document.getElementById('entryMaintCost').value);
    }

    if (!state.entries[state.activeCarId]) {
      state.entries[state.activeCarId] = [];
    }

    if (indexStr === "") {
      state.entries[state.activeCarId].push(entryObj);
    } else {
      const idx = parseInt(indexStr);
      if (state.entries[state.activeCarId][idx]) {
        entryObj.id = state.entries[state.activeCarId][idx].id;
        state.entries[state.activeCarId][idx] = entryObj;
      }
    }

    saveData();
    closeEntryModal();
    renderApp();
  });
}

function openCarModal(index = null) {
  const modal = document.getElementById('carModal');
  const form = document.getElementById('carForm');
  form.reset();

  if (index !== null && state.cars[index]) {
    document.getElementById('carModalTitle').textContent = "Edit Vehicle";
    document.getElementById('carIndex').value = index;
    document.getElementById('carName').value = state.cars[index].name;
    document.getElementById('carMake').value = state.cars[index].make || '';
    document.getElementById('carYear').value = state.cars[index].year || '';
  } else {
    document.getElementById('carModalTitle').textContent = "Add New Vehicle";
    document.getElementById('carIndex').value = "";
  }
  modal.classList.add('active');
}

function closeCarModal() {
  document.getElementById('carModal').classList.remove('active');
}

function openEntryModal(index = null) {
  const modal = document.getElementById('entryModal');
  const form = document.getElementById('entryForm');
  form.reset();

  // Reset display styles
  document.getElementById('entryLogType').value = 'fuel';
  document.getElementById('fuelFieldsGroup').style.display = 'block';
  document.getElementById('maintenanceFieldsGroup').style.display = 'none';
  document.getElementById('entryFuel').setAttribute('required', 'true');
  document.getElementById('entryPrice').setAttribute('required', 'true');
  document.getElementById('entryMaintDesc').removeAttribute('required');
  document.getElementById('entryMaintCost').removeAttribute('required');

  document.querySelectorAll('.unit-dist-label').forEach(e => e.textContent = state.settings.distanceUnit === 'miles' ? 'mi' : 'km');
  document.querySelectorAll('.unit-fuel-label').forEach(e => e.textContent = state.settings.fuelUnit === 'gallons' ? 'gal' : 'L');

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('entryDate').value = today;

  if (index !== null && state.activeCarId && state.entries[state.activeCarId][index]) {
    const e = state.entries[state.activeCarId][index];
    document.getElementById('entryModalTitle').textContent = "Edit Log Entry";
    document.getElementById('entryIndex').value = index;
    document.getElementById('entryDate').value = e.date;
    document.getElementById('entryOdometer').value = e.odometer;

    const logType = e.logType || 'fuel';
    document.getElementById('entryLogType').value = logType;

    if (logType === 'fuel') {
      document.getElementById('entryFuel').value = e.fuel;
      document.getElementById('entryPrice').value = e.price;
      document.getElementById('entryFillType').value = e.fillType;
      document.getElementById('entryLocation').value = e.location || "";
    } else {
      document.getElementById('entryLogType').dispatchEvent(new Event('change'));
      document.getElementById('entryMaintDesc').value = e.description;
      document.getElementById('entryMaintCost').value = e.cost;
    }
  } else {
    document.getElementById('entryModalTitle').textContent = "Log Expense";
    document.getElementById('entryIndex').value = "";
    document.getElementById('entryFillType').value = 'full'; // Default to Full Fill-up
    document.getElementById('entryLocation').value = "";
    detectLocation(document.getElementById('entryLocation')); // Auto detect station city
  }
  modal.classList.add('active');
}

function closeEntryModal() {
  document.getElementById('entryModal').classList.remove('active');
}

// Unit settings logic
function initSettings() {
  const distSelect = document.getElementById('set-distance-unit');
  const fuelSelect = document.getElementById('set-fuel-unit');

  distSelect.value = state.settings.distanceUnit;
  fuelSelect.value = state.settings.fuelUnit;

  distSelect.addEventListener('change', (e) => {
    state.settings.distanceUnit = e.target.value;
    saveData();
    renderApp();
  });

  fuelSelect.addEventListener('change', (e) => {
    state.settings.fuelUnit = e.target.value;
    saveData();
    renderApp();
  });
}

// Backup & Import
function initBackup() {
  document.getElementById('exportBackupBtn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", `ridewise_backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
  });

  const importTrigger = document.getElementById('importBackupTrigger');
  const importInput = document.getElementById('importBackupInput');
  
  importTrigger.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.cars && parsed.settings) {
          state = parsed;
          saveData();
          alert("Backup successfully restored!");
          window.location.reload();
        } else {
          alert("Invalid backup file structure.");
        }
      } catch (err) {
        alert("Failed to parse the file as JSON.");
      }
    };
    reader.readAsText(file);
  });
}

// Global renderer
function renderApp() {
  updateCarDropdowns();

  const activeCar = state.cars.find(c => c.id === state.activeCarId);
  const dashName = document.getElementById('dashboard-car-name');
  
  if (activeCar) {
    dashName.textContent = `${activeCar.year ? activeCar.year + ' ' : ''}${activeCar.make ? activeCar.make + ' ' : ''}${activeCar.name}`;
  } else {
    dashName.textContent = "Select or add a car to begin tracking";
  }

  // Calculate metrics
  const stats = computeLifetimeStats(state.activeCarId);
  const ecoVal = document.getElementById('stat-avg-economy');
  const ecoUnit = document.getElementById('stat-avg-economy-unit');
  const odoVal = document.getElementById('stat-last-odo');
  const odoUnit = document.getElementById('stat-last-odo-unit');
  const costVal = document.getElementById('stat-total-cost');

  const distLabel = state.settings.distanceUnit === 'miles' ? 'mi' : 'km';
  const fuelLabel = state.settings.fuelUnit === 'gallons' ? 'gal' : 'L';

  if (activeCar && stats.count > 0) {
    if (stats.avgEco !== null) {
      ecoVal.textContent = stats.avgEco.toFixed(2);
      ecoUnit.textContent = state.settings.fuelUnit === 'liters' ? `L/100 ${distLabel}` : `Miles / ${fuelLabel}`;
    } else {
      ecoVal.textContent = "--";
      ecoUnit.textContent = "MPG / L/100km";
    }
    
    odoVal.textContent = stats.lastOdo.toLocaleString();
    odoUnit.textContent = distLabel.toUpperCase();
    costVal.textContent = `$${stats.totalCost.toFixed(2)}`;
  } else {
    ecoVal.textContent = "--";
    ecoUnit.textContent = "MPG / L/100km";
    odoVal.textContent = "--";
    odoUnit.textContent = "MILES / KM";
    costVal.textContent = "--";
  }

  renderRecentEntries();
  renderGarage();
  renderLedger();
  renderCharts();
}

// Render dynamic elements for Dashboard Recent Entries
function renderRecentEntries() {
  const container = document.getElementById('recentEntriesList');
  container.innerHTML = '';

  const allLogs = getSortedEntries(state.activeCarId);
  const calculatedFuel = calculateEfficiencyForEntries(state.activeCarId);

  // Map to unified list for recent display
  const unifiedRecent = allLogs.map(log => {
    if (!log.logType || log.logType === 'fuel') {
      const matchedCalc = calculatedFuel.find(c => c.id === log.id);
      return matchedCalc ? matchedCalc : log;
    }
    return log;
  }).reverse().slice(0, 3);

  if (unifiedRecent.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No entries logged yet.</p>
        <button class="btn btn-primary btn-sm" id="emptyStateAddBtnInline">Log First Expense</button>
      </div>
    `;
    const btn = document.getElementById('emptyStateAddBtnInline');
    if (btn) btn.addEventListener('click', () => openEntryModal());
    return;
  }

  const distLabel = state.settings.distanceUnit === 'miles' ? 'mi' : 'km';
  const fuelLabel = state.settings.fuelUnit === 'gallons' ? 'gal' : 'L';

  unifiedRecent.forEach(e => {
    const dateObj = new Date(e.date + 'T00:00:00');
    const day = dateObj.getDate();
    const month = dateObj.toLocaleString('default', { month: 'short' });

    const card = document.createElement('div');
    card.className = 'entry-row-card';

    const isFuel = !e.logType || e.logType === 'fuel';
    
    let odoDisplayString = "";
    if (isFuel) {
      if (e.distance !== null && e.distance !== undefined) {
        const ecoUnitText = state.settings.fuelUnit === 'liters' ? `L/100${distLabel}` : 'MPG';
        const ecoValText = e.efficiency !== null ? `@ ${e.efficiency.toFixed(1)} ${ecoUnitText}` : '';
        odoDisplayString = `${e.distance.toLocaleString()} ${distLabel} ${ecoValText}`.trim();
      } else {
        // First log baseline or missed baseline
        odoDisplayString = `${e.odometer.toLocaleString()} ${distLabel} (Baseline)`;
      }
    } else {
      odoDisplayString = `Odometer: ${e.odometer.toLocaleString()} ${distLabel}`;
    }

    const detailString = isFuel 
      ? `${e.fuel.toFixed(2)} ${fuelLabel} filled @ $${e.price.toFixed(3)}/unit${e.location ? ' at ' + e.location : ''}`
      : `${e.description}`;
    
    const costString = isFuel 
      ? `$${(e.fuel * e.price).toFixed(2)}`
      : `$${e.cost.toFixed(2)}`;

    const tagClass = isFuel ? e.fillType : 'maintenance';
    const tagText = isFuel ? e.fillType : 'Service';

    card.innerHTML = `
      <div class="entry-row-left">
        <div class="entry-date-badge">
          <span class="entry-date-day">${day}</span>
          <span class="entry-date-month">${month}</span>
        </div>
        <div class="entry-info">
          <span class="entry-odo" style="font-weight: 700; color: #fff;">${odoDisplayString}</span>
          <span class="entry-fuel-volume">${detailString}</span>
        </div>
      </div>
      <div class="entry-row-right">
        <span class="entry-cost">${costString}</span>
        <span class="fill-type-tag ${tagClass}">${tagText}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

// Render dynamic elements for Garage view
function renderGarage() {
  const grid = document.getElementById('garageGrid');
  grid.innerHTML = '';

  state.cars.forEach((car, index) => {
    const stats = computeLifetimeStats(car.id);
    const isActive = car.id === state.activeCarId;
    const distLabel = state.settings.distanceUnit === 'miles' ? 'mi' : 'km';

    const card = document.createElement('div');
    card.className = `glass-card car-card ${isActive ? 'active' : ''}`;
    
    let ecoDisplay = "--";
    if (stats.avgEco !== null) {
      ecoDisplay = state.settings.fuelUnit === 'liters' 
        ? `${stats.avgEco.toFixed(1)} L/100km` 
        : `${stats.avgEco.toFixed(1)} MPG`;
    }

    card.innerHTML = `
      ${isActive ? '<div class="car-active-badge">Primary</div>' : ''}
      <div class="car-header">
        <div class="car-title-group">
          <h3>${car.name}</h3>
          <span>${car.make ? car.make : 'Generic'} ${car.year ? '• ' + car.year : ''}</span>
        </div>
        <div class="car-actions">
          <button class="btn-icon edit-car-btn" data-index="${index}" title="Edit Vehicle">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete-car-btn" data-id="${car.id}" title="Remove Vehicle" style="color: var(--danger-color); border-color: rgba(255,94,98,0.2);">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
      <div class="car-stats-quick">
        <div class="car-quick-stat">
          <span class="label">Avg Eco</span>
          <span class="val">${ecoDisplay}</span>
        </div>
        <div class="car-quick-stat">
          <span class="label">Odometer</span>
          <span class="val">${stats.lastOdo ? stats.lastOdo.toLocaleString() + ' ' + distLabel : '--'}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-icon')) return;
      state.activeCarId = car.id;
      saveData();
      renderApp();
    });

    grid.appendChild(card);
  });

  document.querySelectorAll('.edit-car-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'));
      openCarModal(idx);
    });
  });

  document.querySelectorAll('.delete-car-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (confirm("Are you sure you want to remove this car? All fuel and maintenance entries will be lost.")) {
        state.cars = state.cars.filter(c => c.id !== id);
        delete state.entries[id];
        if (state.activeCarId === id) {
          state.activeCarId = state.cars.length > 0 ? state.cars[0].id : null;
        }
        saveData();
        renderApp();
      }
    });
  });
}

// Render dynamic elements for Ledger view
function renderLedger() {
  const tbody = document.getElementById('entriesTableBody');
  tbody.innerHTML = '';

  const allLogs = getSortedEntries(state.activeCarId);
  const calculatedFuel = calculateEfficiencyForEntries(state.activeCarId);

  if (allLogs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 30px;">
          No fuel or maintenance logs available.
        </td>
      </tr>
    `;
    return;
  }

  const distLabel = state.settings.distanceUnit === 'miles' ? 'mi' : 'km';
  const fuelLabel = state.settings.fuelUnit === 'gallons' ? 'gal' : 'L';

  // Render unified list
  allLogs.map(log => {
    if (!log.logType || log.logType === 'fuel') {
      const matchedCalc = calculatedFuel.find(c => c.id === log.id);
      return matchedCalc ? matchedCalc : log;
    }
    return log;
  }).reverse().forEach((e) => {
    // Find the original index in standard storage
    const originalIdx = state.entries[state.activeCarId].findIndex(o => o.id === e.id);
    const tr = document.createElement('tr');
    
    const isFuel = !e.logType || e.logType === 'fuel';
    
    let detailCol = "";
    let unitCol = "";
    let costCol = "";
    let catCol = "";
    let ecoDisplay = "--";

    if (isFuel) {
      const locationSuffix = e.location ? `<br><small style="color: var(--text-secondary); font-size: 0.75rem;">📍 ${e.location}</small>` : "";
      detailCol = `${e.fuel.toFixed(2)} ${fuelLabel}${locationSuffix}`;
      unitCol = `$${e.price.toFixed(3)}`;
      costCol = `$${(e.fuel * e.price).toFixed(2)}`;
      catCol = `<span class="fill-type-tag ${e.fillType}">${e.fillType}</span>`;
      
      if (e.efficiency !== null) {
        ecoDisplay = state.settings.fuelUnit === 'liters' 
          ? `${e.efficiency.toFixed(1)} L/100km` 
          : `${e.efficiency.toFixed(1)} MPG`;
      }
    } else {
      detailCol = `${e.description}`;
      unitCol = "--";
      costCol = `$${e.cost.toFixed(2)}`;
      catCol = `<span class="fill-type-tag maintenance">Service</span>`;
    }

    let odoCol = `${e.odometer.toLocaleString()} ${distLabel}`;
    if (isFuel && e.distance !== null && e.distance !== undefined) {
      odoCol += `<br><small style="color: var(--text-muted); font-size: 0.75rem;">+${e.distance.toLocaleString()} ${distLabel} trip</small>`;
    }

    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${odoCol}</td>
      <td>${detailCol}</td>
      <td>${unitCol}</td>
      <td>${costCol}</td>
      <td>${catCol}</td>
      <td><strong>${ecoDisplay}</strong></td>
      <td class="action-cell">
        <button class="btn-icon edit-entry-btn" data-index="${originalIdx}" title="Edit Entry">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon delete-entry-btn" data-index="${originalIdx}" title="Delete Entry" style="color: var(--danger-color); border-color: rgba(255,94,98,0.2);">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach button event listeners
  document.querySelectorAll('.edit-entry-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'));
      openEntryModal(idx);
    });
  });

  document.querySelectorAll('.delete-entry-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'));
      if (confirm("Are you sure you want to delete this log entry?")) {
        state.entries[state.activeCarId].splice(idx, 1);
        saveData();
        renderApp();
      }
    });
  });
}

// Dynamic Custom SVG Chart Drawer
function renderCharts() {
  const calculatedFuel = calculateEfficiencyForEntries(state.activeCarId);
  const validEcoPoints = calculatedFuel.filter(e => e.efficiency !== null);

  const ecoSvg = document.getElementById('efficiencyChart');
  const priceSvg = document.getElementById('priceTrendChart');
  const ecoLegend = document.getElementById('efficiencyChartLegend');
  const priceLegend = document.getElementById('priceTrendChartLegend');

  const distLabel = state.settings.distanceUnit === 'miles' ? 'mi' : 'km';
  const fuelLabel = state.settings.fuelUnit === 'gallons' ? 'gal' : 'L';
  const ecoUnitLabel = state.settings.fuelUnit === 'liters' ? `L/100 ${distLabel}` : `Miles / ${fuelLabel}`;

  ecoSvg.innerHTML = '';
  priceSvg.innerHTML = '';

  const defs = `
    <defs>
      <linearGradient id="chartGlowGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00f2fe" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#00f2fe" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="chartGlowGradSecondary" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff9966" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#ff9966" stop-opacity="0"/>
      </linearGradient>
    </defs>
  `;

  // Draw Economy Chart
  if (validEcoPoints.length < 2) {
    ecoSvg.innerHTML = `<text x="250" y="110" dominant-baseline="middle" text-anchor="middle" fill="var(--text-muted)">Need at least 2 full fill-ups to graph economy</text>`;
    ecoLegend.innerHTML = '<span>Economy over time</span>';
  } else {
    const padding = { top: 20, right: 30, bottom: 30, left: 45 };
    const width = 500;
    const height = 220;

    const values = validEcoPoints.map(e => e.efficiency);
    const minVal = Math.min(...values) * 0.9;
    const maxVal = Math.max(...values) * 1.1;
    const range = maxVal - minVal;

    let pathPoints = '';
    let fillPoints = `M ${padding.left} ${height - padding.bottom} `;
    let pointCircles = '';

    validEcoPoints.forEach((e, idx) => {
      const x = padding.left + (idx / (validEcoPoints.length - 1)) * (width - padding.left - padding.right);
      const y = height - padding.bottom - ((e.efficiency - minVal) / range) * (height - padding.top - padding.bottom);
      
      if (idx === 0) {
        pathPoints += `M ${x} ${y} `;
      } else {
        pathPoints += `L ${x} ${y} `;
      }
      fillPoints += `L ${x} ${y} `;
      
      pointCircles += `<circle cx="${x}" cy="${y}" r="4" class="chart-point"><title>Date: ${e.date}\nEconomy: ${e.efficiency.toFixed(1)} ${ecoUnitLabel}</title></circle>`;
    });
    
    fillPoints += `L ${width - padding.right} ${height - padding.bottom} Z`;

    let grids = '';
    const gridLinesCount = 4;
    for (let i = 0; i <= gridLinesCount; i++) {
      const y = padding.top + (i / gridLinesCount) * (height - padding.top - padding.bottom);
      const labelVal = maxVal - (i / gridLinesCount) * range;
      grids += `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid-line" />
        <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis-text">${labelVal.toFixed(0)}</text>
      `;
    }

    ecoSvg.innerHTML = defs + grids + `
      <path d="${fillPoints}" class="chart-fill" />
      <path d="${pathPoints}" class="chart-line" />
      ${pointCircles}
    `;

    ecoLegend.innerHTML = `<span><strong>Min:</strong> ${Math.min(...values).toFixed(1)}</span> | <span><strong>Max:</strong> ${Math.max(...values).toFixed(1)}</span>`;
  }

  // Draw Price Trend Chart (Fuel Only)
  const fuelEntries = getSortedFuelEntries(state.activeCarId);
  if (fuelEntries.length < 2) {
    priceSvg.innerHTML = `<text x="250" y="110" dominant-baseline="middle" text-anchor="middle" fill="var(--text-muted)">Need at least 2 fuel entries to graph price trends</text>`;
    priceLegend.innerHTML = '<span>Price over time</span>';
  } else {
    const padding = { top: 20, right: 30, bottom: 30, left: 45 };
    const width = 500;
    const height = 220;

    const values = fuelEntries.map(e => e.price);
    const minVal = Math.min(...values) * 0.95;
    const maxVal = Math.max(...values) * 1.05;
    const range = maxVal - minVal || 1;

    let pathPoints = '';
    let fillPoints = `M ${padding.left} ${height - padding.bottom} `;
    let pointCircles = '';

    fuelEntries.forEach((e, idx) => {
      const x = padding.left + (idx / (fuelEntries.length - 1)) * (width - padding.left - padding.right);
      const y = height - padding.bottom - ((e.price - minVal) / range) * (height - padding.top - padding.bottom);
      
      if (idx === 0) {
        pathPoints += `M ${x} ${y} `;
      } else {
        pathPoints += `L ${x} ${y} `;
      }
      fillPoints += `L ${x} ${y} `;
      
      pointCircles += `<circle cx="${x}" cy="${y}" r="4" class="chart-point" style="fill: #ff9966;"><title>Date: ${e.date}\nPrice: $${e.price.toFixed(3)}</title></circle>`;
    });
    
    fillPoints += `L ${width - padding.right} ${height - padding.bottom} Z`;

    let grids = '';
    const gridLinesCount = 4;
    for (let i = 0; i <= gridLinesCount; i++) {
      const y = padding.top + (i / gridLinesCount) * (height - padding.top - padding.bottom);
      const labelVal = maxVal - (i / gridLinesCount) * range;
      grids += `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid-line" />
        <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end" class="chart-axis-text">$${labelVal.toFixed(2)}</text>
      `;
    }

    priceSvg.innerHTML = defs + grids + `
      <path d="${fillPoints}" class="chart-fill-secondary" />
      <path d="${pathPoints}" class="chart-line-secondary" />
      ${pointCircles}
    `;

    priceLegend.innerHTML = `<span><strong>Min:</strong> $${Math.min(...values).toFixed(2)}</span> | <span><strong>Max:</strong> $${Math.max(...values).toFixed(2)}</span>`;
  }

  // Set detailed lifetime stats texts
  const stats = computeLifetimeStats(state.activeCarId);
  const detDist = document.getElementById('det-stat-dist');
  const detFuel = document.getElementById('det-stat-fuel');
  const detPrice = document.getElementById('det-stat-avg-price');
  const detCount = document.getElementById('det-stat-count');

  if (state.activeCarId && stats.count > 0) {
    detDist.textContent = `${stats.totalDist.toLocaleString()} ${distLabel}`;
    detFuel.textContent = `$${stats.totalCost.toFixed(2)}`;
    detPrice.textContent = stats.avgPrice > 0 ? `$${stats.avgPrice.toFixed(3)}/${fuelLabel}` : "--";
    detCount.textContent = stats.count;
  } else {
    detDist.textContent = "--";
    detFuel.textContent = "--";
    detPrice.textContent = "--";
    detCount.textContent = "--";
  }
}
