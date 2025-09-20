document.addEventListener('DOMContentLoaded', function() {
    // --- ГЛОБАЛЬНЫЙ СТАТУС ---
    const STATE = {
        user: null,
        userBalance: 0,
        inventory: [],
        gameHistory: [],
        isSpinning: false,
        isFastSpinEnabled: false,
        openQuantity: 1,
        casePrice: 100,
        lastWonItems: [],
        contest: null,
        ticketQuantity: 1,
        possibleItems: [],
        gameSettings: {},
        upgradeState: {
            yourItem: null,
            desiredItem: null,
            chance: 0,
            multiplier: 0,
            isUpgrading: false,
            activePicker: 'inventory',
            maxChance: 95,
            currentRotation: 0,
        },
        minerState: {
            isActive: false, bet: 100, bombs: 6, grid: [], openedCrystals: 0, currentMultiplier: 1, totalWin: 0,
        },
        coinflipState: { isFlipping: false },
        rpsState: { isPlaying: false, choices: ['rock', 'paper', 'scissors'], choiceMap: { rock: '✊', paper: '✋', scissors: '✌️' } },
        slotsState: { isSpinning: false, symbols: [{ name: 'Lemon', imageSrc: 'images/slot_lemon.png' }, { name: 'Cherry', imageSrc: 'images/slot_cherry.png' }, { name: 'Seven', imageSrc: 'images/slot_7.png' }] },
        towerState: { isActive: false, isCashingOut: false, bet: 15, currentLevel: 0, levels: 5, grid: [], payouts: [], multipliers: [1.5, 2.5, 4, 8, 16], nextLevelTimeout: null }
    };

    // --- ОБЪЕКТ С ЭЛЕМЕНТАМИ DOM ---
    const UI = {};

    // --- ФУНКЦИИ ---

    function showNotification(message) {
        if (!UI.notificationToast) return;
        UI.notificationToast.textContent = message;
        UI.notificationToast.classList.add('visible');
        setTimeout(() => UI.notificationToast.classList.remove('visible'), 3000);
    }

    // --- НОВАЯ ФУНКЦИЯ СИНХРОНИЗАЦИИ БАЛАНСА ---
    async function syncBalanceWithBot(balanceChange) {
        if (!STATE.user || !STATE.user.telegram_id || balanceChange === 0) return;
        try {
            const response = await fetch('/api/user/update-balance', { // Используем новый эндпоинт
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: STATE.user.telegram_id,
                    balance_change: balanceChange // Отправляем изменение, а не новый баланс
                })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to sync balance with bot');
            }
            console.log('Balance sync successful for change:', balanceChange);
        } catch (error) {
            console.error("Ошибка синхронизации баланса с ботом:", error);
            showNotification('Ошибка синхронизации баланса.');
        }
    }


    async function authenticateUser(tgUser) {
        try {
            const response = await fetch('/api/user/get-or-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: tgUser.id,
                    username: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim()
                })
            });
            if (!response.ok) throw new Error('Authentication failed');
            const userData = await response.json();
            STATE.user = userData;
            STATE.userBalance = userData.balance;
            updateBalanceDisplay();
            await loadInventory();
            loadContestData();
        } catch (error) {
            console.error("Ошибка аутентификации:", error);
            showNotification('Не удалось подключиться к серверу.');
        }
    }

    async function loadInventory() {
        if (!STATE.user || !STATE.user.id) return;
        try {
            const response = await fetch(`/api/user/inventory?user_id=${STATE.user.id}`);
            if (!response.ok) throw new Error('Could not fetch inventory');
            const inventoryData = await response.json();
            STATE.inventory = inventoryData;
            renderInventory();
        } catch (error) {
            console.error("Ошибка загрузки инвентаря:", error);
        }
    }


    function loadTelegramData() {
        try {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.BackButton.hide();
            const user = tg.initDataUnsafe.user;
            if (user && user.id) {
                if (UI.profilePhoto) UI.profilePhoto.src = user.photo_url || '';
                if (UI.profileName) UI.profileName.textContent = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                if (UI.profileId) UI.profileId.textContent = `ID ${user.id}`;
                authenticateUser(user);
            } else {
                 console.warn("Данные пользователя Telegram не найдены. Работа в режиме гостя.");
                 if (UI.profileName) UI.profileName.textContent = "Guest";
                 if (UI.profileId) UI.profileId.textContent = "ID 0";
                 STATE.userBalance = 1000;
                 updateBalanceDisplay();
            }
        } catch (error) {
            console.error("Не удалось загрузить данные Telegram:", error);
            if (UI.profileName) UI.profileName.textContent = "Guest";
            if (UI.profileId) UI.profileId.textContent = "ID 0";
        }
    }

    function inviteFriend() {
        try {
            const tg = window.Telegram.WebApp;
            const user = tg.initDataUnsafe.user;
            const app_url = `https://t.me/qqtest134_bot/website?startapp=${user.id}`;
            const text = `Привет! Присоединяйся к StarsDrop и получай крутые подарки!`;
            tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(app_url)}&text=${encodeURIComponent(text)}`);
        } catch(e) {
            console.error(e);
            showNotification("Функция доступна только в Telegram.");
        }
    }

    function copyInviteLink() {
        try {
            const tg = window.Telegram.WebApp;
            const user = tg.initDataUnsafe.user;
            const app_url = `https://t.me/qqtest134_bot/website?startapp=${user.id}`;
            navigator.clipboard.writeText(app_url).then(() => {
                showNotification('Ссылка скопирована!');
            }).catch(err => {
                console.error('Не удалось скопировать ссылку: ', err);
                showNotification('Ошибка копирования.');
            });
        } catch(e) {
            console.error(e);
            showNotification("Функция доступна только в Telegram.");
        }
    }

    function updateBalanceDisplay() {
        if (UI.userBalanceElement) UI.userBalanceElement.innerText = Math.round(STATE.userBalance).toLocaleString('ru-RU');
    }

    function showModal(modal) {
        if (modal && UI.modalOverlay) {
            modal.classList.add('visible');
            UI.modalOverlay.classList.add('visible');
        }
    }

    function hideModal(modal) {
        if (modal && UI.modalOverlay) {
            modal.classList.remove('visible');
            if (!document.querySelector('.modal.visible')) {
                UI.modalOverlay.classList.remove('visible');
            }
        }
    }

    function switchView(viewId) {
        UI.views.forEach(view => view.classList.remove('active'));
        UI.navButtons.forEach(btn => btn.classList.remove('active'));

        const viewToShow = document.getElementById(viewId);
        let btnToActivate;

        if (viewToShow) {
            viewToShow.classList.add('active');
            if (['upgrade-view', 'miner-view', 'coinflip-view', 'rps-view', 'slots-view', 'tower-view'].includes(viewId)) {
                btnToActivate = document.querySelector('.nav-btn[data-view="games-menu-view"]');
            } else {
                btnToActivate = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
            }
        } else {
            console.error(`Экран с ID "${viewId}" не найден.`);
            document.getElementById('game-view').classList.add('active');
            btnToActivate = document.querySelector('.nav-btn[data-view="game-view"]');
        }

        if (btnToActivate) btnToActivate.classList.add('active');

        const tg = window.Telegram?.WebApp;
        if (tg) {
            if (tg.BackButton.isVisible) tg.BackButton.offClick();
            if (['upgrade-view', 'miner-view', 'coinflip-view', 'rps-view', 'slots-view', 'tower-view'].includes(viewId)) {
                tg.BackButton.show();
                tg.BackButton.onClick(() => switchView('games-menu-view'));
            } else if (['games-menu-view', 'contests-view', 'friends-view', 'profile-view'].includes(viewId)) {
                 tg.BackButton.show();
                 tg.BackButton.onClick(() => switchView('game-view'));
            } else {
                tg.BackButton.hide();
            }
        }

        if (viewId === 'profile-view') {
            loadInventory();
            renderHistory();
        }
        if (viewId === 'upgrade-view') resetUpgradeState(true);
        if (viewId === 'contests-view') loadContestData();
        if (viewId === 'miner-view') resetMinerGame();
        if (viewId === 'tower-view') resetTowerGame();
    }

    function renderInventory() {
        if (!UI.inventoryContent) return;
        UI.inventoryContent.innerHTML = '';
        if (!STATE.inventory || STATE.inventory.length === 0) {
            UI.inventoryContent.innerHTML = `<p class="inventory-empty-msg">Ваш инвентарь пуст</p>`;
            return;
        }
        STATE.inventory.forEach((item) => {
            const itemEl = document.createElement('div');
            itemEl.classList.add('inventory-item');
            itemEl.innerHTML = `
                <img src="${item.imageSrc}" alt="${item.name}">
                <div class="inventory-item-name">${item.name}</div>
                <button class="inventory-sell-btn">
                    Продать за <span class="icon">⭐</span> ${item.value.toLocaleString('ru-RU')}
                </button>
            `;
            itemEl.querySelector('.inventory-sell-btn').addEventListener('click', () => sellFromInventory(item)); // Передаем весь объект
            UI.inventoryContent.appendChild(itemEl);
        });
    }

    async function sellFromInventory(itemToSell) {
        if (!STATE.user || !STATE.user.id) return;
        try {
            const response = await fetch('/api/user/inventory/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: STATE.user.id, unique_id: itemToSell.uniqueId })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Server error');

            STATE.userBalance = result.newBalance;
            updateBalanceDisplay();
            await loadInventory();
            showNotification('Предмет продан!');

        } catch (error) {
            console.error("Ошибка при продаже предмета:", error);
            showNotification('Не удалось продать предмет.');
        }
    }


    function renderHistory() {
        if (!UI.historyContent) return;
        UI.historyContent.innerHTML = '';
        if (STATE.gameHistory.length === 0) {
            UI.historyContent.innerHTML = `<p class="inventory-empty-msg">История игр пуста</p>`;
            return;
        }
        [...STATE.gameHistory].reverse().forEach(entry => {
            const itemEl = document.createElement('div');
            itemEl.classList.add('history-item');
            const eventDate = new Date(entry.date);
            itemEl.innerHTML = `
                <img src="${entry.imageSrc}" alt="${entry.name}">
                <div class="history-item-info">
                    <div class="history-item-name">${entry.name}</div>
                    <div class="history-item-date">${eventDate.toLocaleString('ru-RU')}</div>
                </div>
                <div class="history-item-price">${entry.value > 0 ? '+' : ''}<span class="icon">⭐</span>${entry.value.toLocaleString('ru-RU')}</div>
            `;
            UI.historyContent.appendChild(itemEl);
        });
    }

    function handleCaseClick() {
        updatePriceMessage();
        showModal(UI.preOpenModal);
    }

    function updatePriceMessage() {
        if (!UI.priceCheckMessage) return;
        const totalCost = STATE.casePrice * STATE.openQuantity;
        if (STATE.userBalance >= totalCost) {
            UI.priceCheckMessage.innerHTML = `⭐ ${totalCost.toLocaleString('ru-RU')}`;
            UI.priceCheckMessage.classList.remove('error');
            UI.startSpinBtn.disabled = false;
        } else {
            UI.priceCheckMessage.innerHTML = `⭐ ${totalCost.toLocaleString('ru-RU')} (не хватает ${(totalCost - STATE.userBalance).toLocaleString('ru-RU')})`;
            UI.priceCheckMessage.classList.add('error');
            UI.startSpinBtn.disabled = true;
        }
    }

    function handleQuantityChange(event) {
        const target = event.target;
        if (target.classList.contains('quantity-btn')) {
            UI.quantitySelector.querySelector('.active').classList.remove('active');
            target.classList.add('active');
            STATE.openQuantity = parseInt(target.innerText);
            updatePriceMessage();
        }
    }

    async function startSpinProcess() {
        if (STATE.isSpinning || !STATE.user) return;
        const totalCost = STATE.casePrice * STATE.openQuantity;
        if (STATE.userBalance < totalCost) return showNotification("Недостаточно средств.");

        try {
            const response = await fetch('/api/case/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: STATE.user.id, quantity: STATE.openQuantity })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error);

            STATE.isSpinning = true;
            STATE.userBalance = result.newBalance;
            updateBalanceDisplay();
            hideModal(UI.preOpenModal);

            STATE.lastWonItems = result.wonItems;

            STATE.gameHistory.push(...result.wonItems.map(item => ({ ...item, date: new Date(), name: `Выигрыш из кейса` })));

            UI.caseView.classList.add('hidden');
            UI.spinView.classList.remove('hidden');

            if (STATE.openQuantity > 1) {
                startMultiVerticalAnimation();
            } else {
                startHorizontalAnimation();
            }

        } catch(error) {
            console.error("Ошибка открытия кейса:", error);
            showNotification(error.message || "Не удалось открыть кейс");
        }
    }

    function startHorizontalAnimation() {
        UI.spinnerContainer.classList.remove('hidden');
        UI.multiSpinnerContainer.classList.add('hidden');
        const winnerItem = STATE.lastWonItems[0];
        const reelLength = 60, winnerIndex = 50;
        const reel = Array.from({ length: reelLength }, (_, i) => i === winnerIndex ? winnerItem : STATE.possibleItems[Math.floor(Math.random() * STATE.possibleItems.length)]);
        UI.rouletteTrack.innerHTML = reel.map(item => `<div class="roulette-item"><img src="${item.imageSrc}" alt="${item.name}"></div>`).join('');
        const itemWidth = 130;
        const targetPosition = (winnerIndex * itemWidth) + (itemWidth / 2);
        const animationDuration = STATE.isFastSpinEnabled ? '0.2s' : '6s';
        UI.rouletteTrack.style.transition = 'none';
        UI.rouletteTrack.style.left = '0px';
        UI.rouletteTrack.getBoundingClientRect();
        UI.rouletteTrack.style.transition = `left ${animationDuration} cubic-bezier(0.2, 0.8, 0.2, 1)`;
        UI.rouletteTrack.style.left = `calc(50% - ${targetPosition}px)`;
        UI.rouletteTrack.addEventListener('transitionend', showResult, { once: true });
    }

    function startMultiVerticalAnimation() {
        UI.spinnerContainer.classList.add('hidden');
        UI.multiSpinnerContainer.classList.remove('hidden');
        UI.multiSpinnerContainer.innerHTML = '';
        let animationsFinished = 0;
        const animationDuration = STATE.isFastSpinEnabled ? 0.2 : 5;

        STATE.lastWonItems.forEach((winnerItem) => {
            const spinnerColumn = document.createElement('div');
            spinnerColumn.className = 'vertical-spinner';
            const track = document.createElement('div');
            track.className = 'vertical-roulette-track';
            const reelLength = 60, winnerIndex = 50;
            const reel = Array.from({ length: reelLength }, (_, i) => i === winnerIndex ? winnerItem : STATE.possibleItems[Math.floor(Math.random() * STATE.possibleItems.length)]);
            track.innerHTML = reel.map(item => `<div class="vertical-roulette-item"><img src="${item.imageSrc}" alt="${item.name}"></div>`).join('');
            spinnerColumn.appendChild(track);
            UI.multiSpinnerContainer.appendChild(spinnerColumn);
            const itemHeight = 110;
            const targetPosition = (winnerIndex * itemHeight) + (itemHeight / 2);
            track.style.transition = 'none';
            track.style.top = '0px';
            track.getBoundingClientRect();
            track.style.transition = `top ${animationDuration + Math.random() * (STATE.isFastSpinEnabled ? 0.1 : 2)}s cubic-bezier(0.2, 0.8, 0.2, 1)`;
            track.style.top = `calc(50% - ${targetPosition}px)`;
            track.addEventListener('transitionend', () => {
                animationsFinished++;
                if (animationsFinished === STATE.lastWonItems.length) showResult();
            }, { once: true });
        });
    }

    function showResult() {
        UI.resultModal.innerHTML = '';
        const totalValue = STATE.lastWonItems.reduce((sum, item) => sum + item.value, 0);
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.innerHTML = `
            <button class="close-btn">✖</button>
            <h2 class="modal-case-title">Ваш выигрыш:</h2>
            <div class="result-items-container">${STATE.lastWonItems.map(item => `
                <div class="inventory-item">
                    <img src="${item.imageSrc}" alt="${item.name}">
                    <div class="inventory-item-name">${item.name}</div>
                    <div class="inventory-item-price">⭐ ${item.value.toLocaleString('ru-RU')}</div>
                </div>`).join('')}
            </div>
            <div class="result-buttons">
                <button class="secondary-button" id="result-sell-btn">Продать все за ⭐ ${totalValue.toLocaleString('ru-RU')}</button>
                <button class="primary-button" id="result-spin-again-btn">Крутить еще</button>
            </div>`;
        UI.resultModal.appendChild(modalContent);

        const finalizeAction = async () => {
            hideModal(UI.resultModal);
            UI.spinView.classList.add('hidden');
            UI.caseView.classList.remove('hidden');
            STATE.isSpinning = false;
            await loadInventory();
        };

        modalContent.querySelector('.close-btn').addEventListener('click', finalizeAction);
        modalContent.querySelector('#result-spin-again-btn').addEventListener('click', () => {
            finalizeAction();
            setTimeout(handleCaseClick, 100);
        });
        modalContent.querySelector('#result-sell-btn').addEventListener('click', async () => {
            STATE.userBalance += totalValue;
            updateBalanceDisplay();
            // syncBalanceWithBot(totalValue); // Синхронизируем продажу
            showNotification('Предметы проданы!');
            await finalizeAction();
        });
        showModal(UI.resultModal);
    }

    function populateCasePreview() {
        if (!UI.caseContentsPreview) return;
        UI.caseContentsPreview.innerHTML = !STATE.possibleItems || STATE.possibleItems.length === 0
            ? `<p class="inventory-empty-msg">Содержимое кейса пусто</p>`
            : [...STATE.possibleItems].sort((a,b) => b.value - a.value).map(item => `
                <div class="preview-item">
                    <img src="${item.imageSrc}" alt="${item.name}">
                    <div class="inventory-item-price">⭐ ${item.value.toLocaleString('ru-RU')}</div>
                </div>`).join('');
    }

    async function loadContestData() {
        if (!STATE.user || !STATE.user.telegram_id) return;
        try {
            const response = await fetch(`/api/contest/current?telegram_id=${STATE.user.telegram_id}`);
            if (!response.ok) throw new Error('Network error');
            STATE.contest = await response.json();
            updateContestUI();
        } catch (error) {
            console.error("Не удалось загрузить данные о конкурсе:", error);
        }
    }

    function updateContestUI() {
        if (!UI.buyTicketBtn) return;
        if (!STATE.contest) {
            if (UI.contestCard) UI.contestCard.innerHTML = '<p>Активных конкурсов нет.</p>';
            return;
        }
        const { contest } = STATE;
        const totalCost = contest.ticket_price * STATE.ticketQuantity;
        if (UI.contestItemImage) UI.contestItemImage.src = contest.itemImageSrc;
        if (UI.contestItemName) UI.contestItemName.textContent = contest.itemName;
        if (UI.userTicketsDisplay) UI.userTicketsDisplay.textContent = contest.userTickets || 0;
        if (UI.contestParticipants) UI.contestParticipants.textContent = `👥 ${contest.participants || 0}`;
        if (UI.buyTicketBtn) {
            UI.buyTicketBtn.innerHTML = `Купить билет <span class="icon">⭐</span> ${totalCost.toLocaleString('ru-RU')}`;
            UI.buyTicketBtn.disabled = STATE.userBalance < totalCost;
        }
        if (UI.ticketQuantityInput) UI.ticketQuantityInput.value = STATE.ticketQuantity;
    }

    function handleTicketQuantityChange(amount) {
        STATE.ticketQuantity = Math.max(1, STATE.ticketQuantity + amount);
        updateContestUI();
    }

    async function buyTickets() {
        if (!STATE.contest || !STATE.user) return showNotification('Ошибка: данные не загружены.');
        const totalCost = STATE.contest.ticket_price * STATE.ticketQuantity;
        if (STATE.userBalance < totalCost) return showNotification('Недостаточно средств.');

        try {
            const response = await fetch('/api/contest/buy-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contest_id: STATE.contest.id,
                    telegram_id: STATE.user.telegram_id,
                    quantity: STATE.ticketQuantity
                })
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error);
            }
            STATE.userBalance = result.newBalance;
            updateBalanceDisplay();
            showNotification(`Вы успешно приобрели ${STATE.ticketQuantity} билет(ов)!`);
            await loadContestData();
        } catch (error) {
            console.error("Ошибка при покупке билета:", error);
            showNotification(error.message);
        }
    }

    function updateTimer() {
        if (!UI.contestTimer || !STATE.contest || !STATE.contest.end_time) {
            if (UI.contestTimer) UI.contestTimer.textContent = 'Конкурс неактивен';
            return;
        }
        const timeLeft = new Date(Number(STATE.contest.end_time)) - new Date();
        if (timeLeft <= 0) {
            UI.contestTimer.textContent = 'Конкурс завершен';
            return;
        }
        const d = Math.floor(timeLeft / 86400000), h = Math.floor((timeLeft % 86400000) / 3600000), m = Math.floor((timeLeft % 3600000) / 60000), s = Math.floor((timeLeft % 60000) / 1000);
        UI.contestTimer.textContent = `${d}д ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} 🕔`;
    }

    function resetUpgradeState(resetRotation = false) {
        if (!UI.upgradePointer) return;
        STATE.upgradeState.yourItem = null;
        STATE.upgradeState.desiredItem = null;
        STATE.upgradeState.isUpgrading = false;
        if (resetRotation) {
            STATE.upgradeState.currentRotation = 0;
            UI.upgradePointer.style.transition = 'none';
            UI.upgradePointer.style.transform = `translateX(-50%) rotate(0deg)`;
        }
        calculateUpgradeChance();
        renderUpgradeUI();
        renderItemPicker();
    }

    function calculateUpgradeChance() {
        const { yourItem, desiredItem, maxChance } = STATE.upgradeState;
        if (!yourItem || !desiredItem) {
            STATE.upgradeState.chance = 0;
            STATE.upgradeState.multiplier = 0;
            return;
        }
        if (desiredItem.value <= yourItem.value) {
            STATE.upgradeState.chance = maxChance;
            STATE.upgradeState.multiplier = desiredItem.value / yourItem.value;
            return;
        }
        const chance = (yourItem.value / desiredItem.value) * (maxChance / 100) * 100;
        STATE.upgradeState.chance = Math.min(chance, maxChance);
        STATE.upgradeState.multiplier = desiredItem.value / yourItem.value;
    }

    function renderUpgradeUI() {
        if (!UI.yourItemSlot) return;
        const { yourItem, desiredItem, chance, multiplier } = STATE.upgradeState;
        function updateSlot(slot, item) {
            const placeholder = slot.querySelector('.slot-placeholder'), content = slot.querySelector('.slot-content');
            if (item) {
                placeholder.classList.add('hidden');
                content.classList.remove('hidden');
                content.querySelector('img').src = item.imageSrc;
                content.querySelector('img').alt = item.name;
                content.querySelector('span').textContent = item.name;
            } else {
                placeholder.classList.remove('hidden');
                content.classList.add('hidden');
            }
        }
        updateSlot(UI.yourItemSlot, yourItem);
        updateSlot(UI.desiredItemSlot, desiredItem);
        UI.upgradeChanceDisplay.textContent = `${chance.toFixed(2)}%`;
        UI.upgradeMultiplierDisplay.textContent = `x${multiplier.toFixed(2)}`;
        const angle = (chance / 100) * 360;
        UI.upgradeWheel.style.backgroundImage = `conic-gradient(var(--accent-color) ${angle}deg, var(--card-bg-color) ${angle}deg)`;
        UI.performUpgradeBtn.disabled = !yourItem || !desiredItem || STATE.upgradeState.isUpgrading;
    }

    function renderItemPicker() {
        if (!UI.itemPickerContent) return;
        UI.itemPickerContent.innerHTML = '';
        const { activePicker, yourItem, desiredItem } = STATE.upgradeState;
        const sourceList = activePicker === 'inventory' ? STATE.inventory : STATE.possibleItems;
        if (sourceList.length === 0) {
            UI.itemPickerContent.innerHTML = `<p class="picker-empty-msg">Список пуст</p>`;
            return;
        }
        sourceList.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'picker-item';
            itemEl.innerHTML = `<img src="${item.imageSrc}" alt="${item.name}"><div class="picker-item-name">${item.name}</div><div class="picker-item-value">⭐ ${item.value.toLocaleString('ru-RU')}</div>`;
            const isSelectedForYour = yourItem && item.uniqueId && yourItem.uniqueId === item.uniqueId;
            const isSelectedForDesired = desiredItem && desiredItem.id === item.id;
            if (isSelectedForYour || isSelectedForDesired) itemEl.classList.add('selected');
            itemEl.addEventListener('click', () => handleItemPick(item));
            UI.itemPickerContent.appendChild(itemEl);
        });
    }

    function handleItemPick(item) {
        if (STATE.upgradeState.isUpgrading) return;
        const { activePicker } = STATE.upgradeState;
        if (activePicker === 'inventory') STATE.upgradeState.yourItem = { ...item };
        else STATE.upgradeState.desiredItem = { ...item };
        calculateUpgradeChance();
        renderUpgradeUI();
        renderItemPicker();
    }

    async function handleUpgradeClick() {
        const { yourItem, desiredItem, chance, isUpgrading } = STATE.upgradeState;
        if (!yourItem || !desiredItem || isUpgrading) return;

        STATE.upgradeState.isUpgrading = true;
        UI.performUpgradeBtn.disabled = true;

        syncBalanceWithBot(-yourItem.value); // Списываем предмет для апгрейда

        const isSuccess = (Math.random() * 100) < chance;
        const chanceAngle = (chance / 100) * 360;
        const randomOffset = Math.random() * 0.9 + 0.05;
        const stopPoint = isSuccess ? chanceAngle * randomOffset : chanceAngle + (360 - chanceAngle) * randomOffset;
        const rotation = (5 * 360) + stopPoint;
        STATE.upgradeState.currentRotation = rotation;

        UI.upgradePointer.style.transition = 'transform 6s cubic-bezier(0.2, 0.8, 0.2, 1)';
        UI.upgradePointer.style.transform = `translateX(-50%) rotate(${STATE.upgradeState.currentRotation}deg)`;

        UI.upgradePointer.addEventListener('transitionend', () => {
            setTimeout(async () => {
                if (isSuccess) {
                    showNotification(`Апгрейд успешный! Вы получили ${desiredItem.name}.`);
                    syncBalanceWithBot(desiredItem.value); // Начисляем новый предмет
                    STATE.gameHistory.push({ ...desiredItem, date: new Date(), name: `Апгрейд до ${desiredItem.name}`, value: desiredItem.value });
                } else {
                    showNotification(`К сожалению, апгрейд не удался. Предмет потерян.`);
                    STATE.gameHistory.push({ ...yourItem, date: new Date(), name: `Неудачный апгрейд ${yourItem.name}`, value: -yourItem.value });
                }
                resetUpgradeState(true);
                await loadInventory();
                renderHistory();
            }, 1500);
        }, { once: true });
    }

    function resetMinerGame() {
        if (!UI.minerGrid) return;
        STATE.minerState.isActive = false;
        STATE.minerState.openedCrystals = 0;
        STATE.minerState.totalWin = 0;
        STATE.minerState.grid = [];
        renderMinerGrid();
        updateMinerUI();
        UI.minerBetInput.disabled = false;
        UI.minerStartBtn.classList.remove('hidden');
        UI.minerCashoutBtn.classList.add('hidden');
        UI.minerInfoWrapper.classList.add('hidden');
    }

    function startMinerGame() {
        const bet = parseInt(UI.minerBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка");
        if (STATE.userBalance < bet) return showNotification("Недостаточно средств");
        STATE.userBalance -= bet;
        updateBalanceDisplay();
        syncBalanceWithBot(-bet); // Синхронизация
        STATE.minerState.isActive = true;
        STATE.minerState.bet = bet;
        STATE.minerState.openedCrystals = 0;
        STATE.minerState.totalWin = 0;
        const totalCells = 12;
        const bombIndices = new Set();
        while (bombIndices.size < STATE.minerState.bombs) {
            bombIndices.add(Math.floor(Math.random() * totalCells));
        }
        STATE.minerState.grid = Array.from({ length: totalCells }, (_, i) => ({ isBomb: bombIndices.has(i), isOpened: false }));
        renderMinerGrid(true);
        updateMinerUI();
        UI.minerBetInput.disabled = true;
        UI.minerStartBtn.classList.add('hidden');
        UI.minerCashoutBtn.classList.remove('hidden');
        UI.minerCashoutBtn.disabled = true;
        UI.minerInfoWrapper.classList.remove('hidden');
    }

    function renderMinerGrid(isGameActive = false) {
        if (!UI.minerGrid) return;
        UI.minerGrid.innerHTML = '';
        STATE.minerState.grid.forEach((cell, index) => {
            const cellEl = document.createElement('div');
            cellEl.classList.add('miner-cell');
            if (cell.isOpened) {
                cellEl.classList.add('opened');
                const img = document.createElement('img');
                img.src = cell.isBomb ? 'images/bomb.png' : 'images/diamond.png';
                cellEl.appendChild(img);
                if (cell.isBomb) cellEl.classList.add('bomb');
            }
            if (isGameActive && !cell.isOpened) {
                cellEl.addEventListener('click', () => handleMinerCellClick(index), { once: true });
            }
            UI.minerGrid.appendChild(cellEl);
        });
    }

    function handleMinerCellClick(index) {
        if (!STATE.minerState.isActive) return;
        const cell = STATE.minerState.grid[index];
        cell.isOpened = true;
        if (cell.isBomb) {
            endMinerGame(false);
        } else {
            STATE.minerState.openedCrystals++;
            updateMinerMultiplierAndWin();
            renderMinerGrid(true);
            updateMinerUI();
            UI.minerCashoutBtn.disabled = false;
            if (STATE.minerState.openedCrystals === (12 - STATE.minerState.bombs)) {
                endMinerGame(true);
            }
        }
    }

    function updateMinerMultiplierAndWin() {
        const { bet, openedCrystals } = STATE.minerState;
        STATE.minerState.currentMultiplier = openedCrystals === 0 ? 1 : Math.pow(1.4, openedCrystals);
        STATE.minerState.totalWin = bet * STATE.minerState.currentMultiplier;
    }

    function getNextWin() {
        const { bet, openedCrystals } = STATE.minerState;
        return bet * Math.pow(1.4, openedCrystals + 1);
    }

    function updateMinerUI() {
        if (!UI.minerNextWin || !UI.minerTotalWin) return;
        if (STATE.minerState.isActive) {
            UI.minerNextWin.textContent = getNextWin().toFixed(2);
            UI.minerTotalWin.textContent = STATE.minerState.openedCrystals > 0 ? STATE.minerState.totalWin.toFixed(2) : '0';
        } else {
            UI.minerTotalWin.textContent = '0';
            UI.minerNextWin.textContent = '0';
        }
    }

    function endMinerGame(isWin) {
        STATE.minerState.isActive = false;
        if (isWin) {
            showNotification(`Выигрыш ${STATE.minerState.totalWin.toFixed(2)} ⭐ зачислен!`);
            STATE.userBalance += STATE.minerState.totalWin;
            updateBalanceDisplay();
            syncBalanceWithBot(STATE.minerState.totalWin); // Синхронизация
        } else {
            showNotification("Вы проиграли! Ставка сгорела.");
        }
        STATE.minerState.grid.forEach(cell => { if (cell.isBomb) cell.isOpened = true; });
        renderMinerGrid(false);
        setTimeout(resetMinerGame, 2000);
    }

    function cashoutMiner() {
        if (!STATE.minerState.isActive || STATE.minerState.openedCrystals === 0) return;
        endMinerGame(true);
    }

    function handleSlotsSpin() {
        if (!UI.slotsSpinBtn || STATE.slotsState.isSpinning) return;
        const bet = parseInt(UI.slotsBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка");
        if (STATE.userBalance < bet) return showNotification("Недостаточно средств");

        STATE.slotsState.isSpinning = true;
        UI.slotsSpinBtn.disabled = true;
        STATE.userBalance -= bet;
        updateBalanceDisplay();
        syncBalanceWithBot(-bet); // Синхронизация
        UI.slotsPayline.classList.remove('visible');

        const results = [];
        const tracks = [UI.slotsTrack1, UI.slotsTrack2, UI.slotsTrack3];
        let reelsFinished = 0;

        tracks.forEach((track, index) => {
            const symbols = STATE.slotsState.symbols;
            const reelLength = 30;
            const finalSymbol = symbols[Math.floor(Math.random() * symbols.length)];
            results[index] = finalSymbol;
            track.innerHTML = Array.from({length: reelLength}, (_, i) => {
                const symbol = i === reelLength - 2 ? finalSymbol : symbols[Math.floor(Math.random() * symbols.length)];
                return `<div class="slots-item"><img src="${symbol.imageSrc}" alt="${symbol.name}"></div>`;
            }).join('');
            track.style.transition = 'none';
            track.style.top = '0px';
            track.offsetHeight;
            const targetPosition = (reelLength - 2) * 90;
            track.style.transition = `top ${2.5 + index * 0.3}s cubic-bezier(0.25, 1, 0.5, 1)`;
            track.style.top = `-${targetPosition}px`;
            track.addEventListener('transitionend', () => {
                reelsFinished++;
                if (reelsFinished === tracks.length) processSlotsResult(results, bet);
            }, { once: true });
        });
    }

    function processSlotsResult(results, bet) {
        let win = 0;
        let message = "Попробуйте еще раз!";
        const [r1, r2, r3] = results;
        if (r1.name === r2.name && r2.name === r3.name) {
            win = bet * 2;
            message = `Победа! Выигрыш x2!`;
        } else if (r1.name === r2.name || r1.name === r3.name || r2.name === r3.name) {
            win = bet * 1.5;
            message = `Неплохо! Выигрыш x1.5!`;
        }
        if (win > 0) {
            STATE.userBalance += win;
            updateBalanceDisplay();
            syncBalanceWithBot(win); // Синхронизация
            UI.slotsPayline.classList.add('visible');
            showNotification(`${message} (+${win.toFixed(0)} ⭐)`);
        } else {
            showNotification(message);
        }
        STATE.slotsState.isSpinning = false;
        UI.slotsSpinBtn.disabled = false;
    }

    function resetTowerGame() {
        if (!UI.towerGameBoard) return;
        if (STATE.towerState.nextLevelTimeout) clearTimeout(STATE.towerState.nextLevelTimeout);
        STATE.towerState.isActive = false;
        STATE.towerState.isCashingOut = false;
        STATE.towerState.currentLevel = 0;
        STATE.towerState.nextLevelTimeout = null;
        UI.towerGameBoard.innerHTML = '';
        UI.towerInitialControls.classList.remove('hidden');
        UI.towerCashoutControls.classList.add('hidden');
        UI.towerBetInput.disabled = false;
        UI.towerMaxWinDisplay.textContent = 'Возможный выигрыш: 0 ⭐';
    }

    function startTowerGame() {
        const bet = parseInt(UI.towerBetInput.value);
        if (isNaN(bet) || bet < 15) return showNotification("Минимальная ставка 15 ⭐");
        if (STATE.userBalance < bet) return showNotification("Недостаточно средств");
        STATE.userBalance -= bet;
        updateBalanceDisplay();
        syncBalanceWithBot(-bet); // Синхронизация
        STATE.towerState.isActive = true;
        STATE.towerState.bet = bet;
        STATE.towerState.currentLevel = 0;
        STATE.towerState.grid = Array.from({ length: STATE.towerState.levels }, () => Math.floor(Math.random() * 2));
        STATE.towerState.payouts = STATE.towerState.multipliers.map(m => Math.round(bet * m));
        UI.towerInitialControls.classList.add('hidden');
        UI.towerCashoutControls.classList.remove('hidden');
        UI.towerCashoutBtn.disabled = true;
        UI.towerCashoutBtn.textContent = `Забрать 0 ⭐`;
        const maxWin = STATE.towerState.payouts[STATE.towerState.payouts.length - 1];
        UI.towerMaxWinDisplay.textContent = `Возможный выигрыш: ${maxWin.toLocaleString('ru-RU')} ⭐`;
        renderTower();
    }

    function renderTower() {
        if (!UI.towerGameBoard) return;
        UI.towerGameBoard.innerHTML = '';
        for (let i = 0; i < STATE.towerState.levels; i++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'tower-row' + (STATE.towerState.isActive && i === STATE.towerState.currentLevel ? ' active' : '');
            const payout = STATE.towerState.payouts[i] || 0;
            for (let j = 0; j < 2; j++) {
                const cell = document.createElement('div');
                cell.className = 'tower-cell';
                cell.dataset.col = j;
                cell.innerHTML = `+${payout.toLocaleString('ru-RU')}`;
                if (STATE.towerState.isActive && i === STATE.towerState.currentLevel) {
                    cell.addEventListener('click', () => handleTowerCellClick(i, j), { once: true });
                }
                if (i < STATE.towerState.currentLevel) {
                    const bombCol = STATE.towerState.grid[i];
                    if (j !== bombCol) {
                        cell.classList.add('safe');
                        cell.innerHTML = `<img src="images/diamond.png" alt="Win">`;
                    } else {
                        cell.style.opacity = "0.5";
                    }
                }
                rowEl.appendChild(cell);
            }
            UI.towerGameBoard.appendChild(rowEl);
        }
    }

    function handleTowerCellClick(row, col) {
        if (!STATE.towerState.isActive || STATE.towerState.isCashingOut || row !== STATE.towerState.currentLevel) return;
        STATE.towerState.isActive = false;
        const bombCol = STATE.towerState.grid[row];
        const cells = UI.towerGameBoard.children[row].querySelectorAll('.tower-cell');
        cells.forEach((c, c_index) => {
            c.classList.add(c_index === bombCol ? 'danger' : 'safe');
            c.innerHTML = `<img src="images/${c_index === bombCol ? 'bomb' : 'diamond'}.png" alt="${c_index === bombCol ? 'Lose' : 'Win'}">`;
        });
        UI.towerGameBoard.children[row].classList.remove('active');
        if (col === bombCol) {
            UI.towerCashoutBtn.disabled = true;
            setTimeout(() => endTowerGame(false), 1200);
        } else {
            STATE.towerState.currentLevel++;
            const cashoutAmount = STATE.towerState.payouts[STATE.towerState.currentLevel - 1];
            UI.towerCashoutBtn.textContent = `Забрать ${cashoutAmount.toLocaleString('ru-RU')} ⭐`;
            UI.towerCashoutBtn.disabled = false;
            if (STATE.towerState.currentLevel === STATE.towerState.levels) {
                setTimeout(() => endTowerGame(true), 1200);
            } else {
                STATE.towerState.nextLevelTimeout = setTimeout(() => {
                    STATE.towerState.isActive = true;
                    renderTower();
                }, 800);
            }
        }
    }

    function endTowerGame(isWin) {
        if (STATE.towerState.nextLevelTimeout) clearTimeout(STATE.towerState.nextLevelTimeout);
        STATE.towerState.isActive = false;
        UI.towerCashoutBtn.disabled = true;
        if (isWin && STATE.towerState.currentLevel > 0) {
            const winAmount = STATE.towerState.payouts[STATE.towerState.currentLevel - 1];
            STATE.userBalance += winAmount;
            updateBalanceDisplay();
            syncBalanceWithBot(winAmount); // Синхронизация
            showNotification(`Выигрыш ${winAmount.toLocaleString('ru-RU')} ⭐ зачислен!`);
        } else {
            showNotification("Вы проиграли! Ставка сгорела.");
            for(let i = STATE.towerState.currentLevel; i < STATE.towerState.levels; i++) {
                const rowEl = UI.towerGameBoard.children[i];
                if(rowEl) {
                    const bombCell = rowEl.querySelector(`.tower-cell[data-col="${STATE.towerState.grid[i]}"]`);
                    if(bombCell && !bombCell.classList.contains('safe') && !bombCell.classList.contains('danger')) {
                        bombCell.classList.add('danger');
                        bombCell.innerHTML = `<img src="images/bomb.png" alt="Lose">`;
                    }
                }
            }
        }
        setTimeout(resetTowerGame, 2500);
    }

    function cashoutTower() {
        if (STATE.towerState.currentLevel === 0 || STATE.towerState.isCashingOut) return;
        if (STATE.towerState.nextLevelTimeout) clearTimeout(STATE.towerState.nextLevelTimeout);
        STATE.towerState.isCashingOut = true;
        STATE.towerState.isActive = false;
        UI.towerCashoutBtn.disabled = true;
        endTowerGame(true);
    }

    function handleCoinflip(playerChoice) {
        if (!UI.coin || STATE.coinflipState.isFlipping) return;
        const bet = parseInt(UI.coinflipBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка");
        if (STATE.userBalance < bet) return showNotification("Недостаточно средств");
        STATE.coinflipState.isFlipping = true;
        UI.coinflipResult.textContent = '';
        STATE.userBalance -= bet;
        updateBalanceDisplay();
        syncBalanceWithBot(-bet); // Списываем ставку
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        UI.coin.addEventListener('transitionend', () => {
            if (playerChoice === result) {
                const winAmount = bet * 2;
                STATE.userBalance += winAmount;
                UI.coinflipResult.textContent = `Вы выиграли ${bet} ⭐!`;
                showNotification(`Победа!`);
                syncBalanceWithBot(winAmount); // Начисляем выигрыш
            } else {
                UI.coinflipResult.textContent = `Вы проиграли ${bet} ⭐.`;
                showNotification(`Проигрыш!`);
            }
            updateBalanceDisplay();
            STATE.coinflipState.isFlipping = false;
            UI.coin.style.transition = 'none';
            UI.coin.style.transform = result === 'tails' ? 'rotateY(180deg)' : 'rotateY(0deg)';
        }, { once: true });
        UI.coin.style.transition = 'transform 1s cubic-bezier(0.5, 1.3, 0.5, 1.3)';
        const currentRotation = UI.coin.style.transform.includes('180') ? 180 : 0;
        const fullSpins = 5 * 360;
        UI.coin.style.transform = `rotateY(${currentRotation + fullSpins + (result === 'tails' ? 180 : 0)}deg)`;
    }

    function handleRps(playerChoice) {
        if (!UI.rpsComputerChoice || STATE.rpsState.isPlaying) return;
        const bet = parseInt(UI.rpsBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка");
        if (STATE.userBalance < bet) return showNotification("Недостаточно средств");
        STATE.rpsState.isPlaying = true;
        UI.rpsButtons.forEach(button => button.disabled = true);
        UI.rpsPlayerChoice.textContent = STATE.rpsState.choiceMap[playerChoice];
        UI.rpsResultMessage.textContent = '';
        const computerChoice = STATE.rpsState.choices[Math.floor(Math.random() * 3)];
        const reelLength = 60, winnerIndex = 50;
        const reel = Array.from({ length: reelLength }, (_, i) => STATE.rpsState.choiceMap[i === winnerIndex ? computerChoice : STATE.rpsState.choices[Math.floor(Math.random() * 3)]]);
        UI.rpsComputerChoice.innerHTML = reel.map(symbol => `<div class="rps-roulette-item">${symbol}</div>`).join('');
        const targetPosition = (winnerIndex * 130) + 65;
        UI.rpsComputerChoice.addEventListener('transitionend', () => {
            let resultMessage = '';
            let balanceChange = -bet; // По умолчанию проигрыш
            if (playerChoice === computerChoice) {
                resultMessage = "Ничья!";
                balanceChange = 0; // Возвращаем ставку
            } else if ((playerChoice === 'rock' && computerChoice === 'scissors') || (playerChoice === 'paper' && computerChoice === 'rock') || (playerChoice === 'scissors' && computerChoice === 'paper')) {
                resultMessage = `Вы выиграли ${bet} ⭐!`;
                balanceChange = bet; // Чистый выигрыш
                showNotification(`Победа!`);
            } else {
                resultMessage = `Вы проиграли ${bet} ⭐.`;
                showNotification(`Проигрыш!`);
            }

            STATE.userBalance += balanceChange + (playerChoice === computerChoice ? bet : 0); // Обновляем баланс
            updateBalanceDisplay();
            syncBalanceWithBot(balanceChange); // Синхронизируем изменение
            UI.rpsResultMessage.textContent = resultMessage;

            setTimeout(() => {
                STATE.rpsState.isPlaying = false;
                UI.rpsButtons.forEach(button => button.disabled = false);
            }, 1500);
        }, { once: true });
        UI.rpsComputerChoice.style.transition = 'none';
        UI.rpsComputerChoice.style.left = '0px';
        UI.rpsComputerChoice.getBoundingClientRect();
        UI.rpsComputerChoice.style.transition = 'left 6s cubic-bezier(0.2, 0.8, 0.2, 1)';
        UI.rpsComputerChoice.style.left = `calc(50% - ${targetPosition}px)`;
    }

    async function loadInitialData() {
        try {
            const [caseResponse, settingsResponse] = await Promise.all([ fetch('/api/case/items_full'), fetch('/api/game_settings') ]);
            if (!caseResponse.ok) throw new Error(`Ошибка загрузки кейсов: ${caseResponse.status}`);
            if (!settingsResponse.ok) throw new Error(`Ошибка загрузки настроек: ${settingsResponse.status}`);
            STATE.possibleItems = await caseResponse.json();
            STATE.gameSettings = await settingsResponse.json();
            applyGameSettings();
            populateCasePreview();
        } catch (error) {
            console.error('Не удалось загрузить данные с сервера:', error);
            showNotification("Ошибка загрузки данных с сервера.");
        }
    }

    function applyGameSettings() {
        if (!UI.gameMenuBtns) return;
        const gameButtons = {
            'upgrade-view': STATE.gameSettings.upgrade_enabled,
            'miner-view': STATE.gameSettings.miner_enabled,
            'coinflip-view': STATE.gameSettings.coinflip_enabled,
            'rps-view': STATE.gameSettings.rps_enabled,
            'slots-view': STATE.gameSettings.slots_enabled,
            'tower-view': STATE.gameSettings.tower_enabled
        };
        UI.gameMenuBtns.forEach(btn => {
            const view = btn.dataset.view;
            if (gameButtons.hasOwnProperty(view)) {
                btn.style.display = (gameButtons[view] === 'false' ? 'none' : '');
            }
        });
    }

    function init() {
        const selectors = {
            notificationToast: '#notification-toast', userBalanceElement: '#user-balance',
            views: '.view', navButtons: '.nav-btn', caseView: '#case-view', spinView: '#spin-view',
            rouletteTrack: '#roulette', spinnerContainer: '#spinner-container',
            multiSpinnerContainer: '#multi-spinner-container', caseImageBtn: '#case-image-btn',
            modalOverlay: '#modal-overlay', preOpenModal: '#pre-open-modal',
            priceCheckMessage: '#price-check-message', quantitySelector: '#quantity-selector',
            fastSpinToggle: '#fast-spin-toggle', caseContentsPreview: '#case-contents-preview',
            startSpinBtn: '#start-spin-btn', resultModal: '#result-modal',
            inventoryContent: '#inventory-content', historyContent: '#history-content',
            profileTabs: '.profile-tabs:not(.upgrade-picker-container) .profile-tab-btn',
            profileContents: '.profile-tab-content', profilePhoto: '#profile-photo',
            profileName: '#profile-name', profileId: '#profile-id',
            inviteFriendBtn: '#invite-friend-btn', copyLinkBtn: '#copy-link-btn',
            contestCard: '#contests-view .contest-card', contestTimer: '#contest-timer',
            buyTicketBtn: '#buy-ticket-btn', ticketQuantityInput: '#ticket-quantity-input',
            ticketQuantityPlus: '#ticket-quantity-plus', ticketQuantityMinus: '#ticket-quantity-minus',
            userTicketsDisplay: '#user-tickets-display', contestItemImage: '.contest-item__image',
            contestItemName: '.contest-item__name', contestParticipants: '#contest-participants',
            upgradeWheel: '#upgrade-wheel', upgradePointer: '#upgrade-pointer',
            upgradeChanceDisplay: '#upgrade-chance-display', upgradeMultiplierDisplay: '#upgrade-multiplier-display',
            yourItemSlot: '#your-item-slot', desiredItemSlot: '#desired-item-slot',
            performUpgradeBtn: '#perform-upgrade-btn', pickerTabs: '.upgrade-picker-container .profile-tab-btn',
            itemPickerContent: '#item-picker-content', gameMenuBtns: '.game-menu-btn',
            minerGrid: '#miner-grid', minerStartBtn: '#miner-start-btn',
            minerCashoutBtn: '#miner-cashout-btn', minerBetInput: '#miner-bet-input',
            minerNextWin: '#miner-next-win', minerTotalWin: '#miner-total-win',
            minerInfoWrapper: '.miner-info-wrapper', coin: '#coin',
            coinflipResult: '#coinflip-result-message', coinflipBetInput: '#coinflip-bet-input',
            coinflipHeadsBtn: '#coinflip-heads-btn', coinflipTailsBtn: '#coinflip-tails-btn',
            rpsPlayerChoice: '#rps-player-choice', rpsComputerChoice: '#rps-computer-choice',
            rpsResultMessage: '#rps-result-message', rpsBetInput: '#rps-bet-input',
            rpsButtons: '.rps-buttons .primary-button', slotsTrack1: '#slots-track-1',
            slotsTrack2: '#slots-track-2', slotsTrack3: '#slots-track-3',
            slotsSpinBtn: '#slots-spin-btn', slotsBetInput: '#slots-bet-input',
            slotsPayline: '.slots-payline', towerGameBoard: '#tower-game-board',
            towerBetInput: '#tower-bet-input', towerMaxWinDisplay: '#tower-max-win-display',
            towerInitialControls: '#tower-initial-controls', towerCashoutControls: '#tower-cashout-controls',
            towerStartBtn: '#tower-start-btn', towerCashoutBtn: '#tower-cashout-btn'
        };

        for (const key in selectors) {
            UI[key] = document.querySelector(selectors[key]);
        }
        UI.views = document.querySelectorAll('.view');
        UI.navButtons = document.querySelectorAll('.nav-btn');
        UI.profileTabs = document.querySelectorAll('.profile-tabs:not(.upgrade-picker-container) .profile-tab-btn');
        UI.profileContents = document.querySelectorAll('.profile-tab-content');
        UI.gameMenuBtns = document.querySelectorAll('.game-menu-btn');
        UI.rpsButtons = document.querySelectorAll('.rps-buttons .primary-button');
        UI.pickerTabs = document.querySelectorAll('.upgrade-picker-container .profile-tab-btn');

        if (UI.caseImageBtn) UI.caseImageBtn.addEventListener('click', handleCaseClick);
        if (UI.startSpinBtn) UI.startSpinBtn.addEventListener('click', startSpinProcess);
        if (UI.quantitySelector) UI.quantitySelector.addEventListener('click', handleQuantityChange);
        if (UI.fastSpinToggle) UI.fastSpinToggle.addEventListener('change', (event) => STATE.isFastSpinEnabled = event.target.checked);
        if (UI.navButtons) UI.navButtons.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
        if (UI.inviteFriendBtn) UI.inviteFriendBtn.addEventListener('click', inviteFriend);
        if (UI.copyLinkBtn) UI.copyLinkBtn.addEventListener('click', copyInviteLink);
        if (UI.buyTicketBtn) UI.buyTicketBtn.addEventListener('click', buyTickets);
        if (UI.ticketQuantityPlus) UI.ticketQuantityPlus.addEventListener('click', () => handleTicketQuantityChange(1));
        if (UI.ticketQuantityMinus) UI.ticketQuantityMinus.addEventListener('click', () => handleTicketQuantityChange(-1));
        if (UI.profileTabs) UI.profileTabs.forEach(tab => tab.addEventListener('click', function () {
            UI.profileTabs.forEach(t => t.classList.remove('active'));
            UI.profileContents.forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(this.dataset.tab + '-content')?.classList.add('active');
        }));
        if (UI.modalOverlay) UI.modalOverlay.addEventListener('click', () => document.querySelectorAll('.modal.visible').forEach(hideModal));
        document.querySelector('[data-close-modal="pre-open-modal"]')?.addEventListener('click', () => hideModal(UI.preOpenModal));
        if (UI.pickerTabs) UI.pickerTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                if (STATE.upgradeState.isUpgrading) return;
                UI.pickerTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                STATE.upgradeState.activePicker = tab.dataset.picker;
                UI.yourItemSlot?.classList.toggle('active-selection', STATE.upgradeState.activePicker === 'inventory');
                UI.desiredItemSlot?.classList.toggle('active-selection', STATE.upgradeState.activePicker === 'desired');
                renderItemPicker();
            });
        });
        if (UI.yourItemSlot) UI.yourItemSlot.addEventListener('click', () => !STATE.upgradeState.isUpgrading && UI.pickerTabs[0]?.click());
        if (UI.desiredItemSlot) UI.desiredItemSlot.addEventListener('click', () => !STATE.upgradeState.isUpgrading && UI.pickerTabs[1]?.click());
        if (UI.performUpgradeBtn) UI.performUpgradeBtn.addEventListener('click', handleUpgradeClick);
        if (UI.gameMenuBtns) UI.gameMenuBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
        if (UI.minerStartBtn) UI.minerStartBtn.addEventListener('click', startMinerGame);
        if (UI.minerCashoutBtn) UI.minerCashoutBtn.addEventListener('click', cashoutMiner);
        if (UI.slotsSpinBtn) UI.slotsSpinBtn.addEventListener('click', handleSlotsSpin);
        if (UI.towerStartBtn) UI.towerStartBtn.addEventListener('click', startTowerGame);
        if (UI.towerCashoutBtn) UI.towerCashoutBtn.addEventListener('click', cashoutTower);
        if (UI.coinflipHeadsBtn) UI.coinflipHeadsBtn.addEventListener('click', () => handleCoinflip('heads'));
        if (UI.coinflipTailsBtn) UI.coinflipTailsBtn.addEventListener('click', () => handleCoinflip('tails'));
        if (UI.rpsButtons) UI.rpsButtons.forEach(button => button.addEventListener('click', () => handleRps(button.dataset.choice)));

        loadTelegramData();
        loadInitialData();
        updateBalanceDisplay();
        switchView('game-view');
        setInterval(updateTimer, 1000);
    }

    try {
        init();
    } catch (error) {
        console.error("Критическая ошибка при инициализации:", error);
        document.body.innerHTML = `<div style="color: white; padding: 20px;">Произошла критическая ошибка: ${error.message}. Пожалуйста, проверьте консоль (F12).</div>`;
    }
});
