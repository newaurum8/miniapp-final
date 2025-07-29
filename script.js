document.addEventListener('DOMContentLoaded', function() {
    // --- ГЛОБАЛЬНЫЙ СТАТУС ---
    const STATE = {
        user: null, // Хранит данные о текущем пользователе
        userBalance: 0,
        inventory: [],
        gameHistory: [],
        isSpinning: false,
        isFastSpinEnabled: false,
        openQuantity: 1,
        casePrice: 100,
        lastWonItems: [],
        contest: null, // Данные о текущем конкурсе будут загружаться сюда
        ticketQuantity: 1,
        possibleItems: [],
        gameSettings: {}, // Для хранения настроек игр
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
            isActive: false,
            bet: 100,
            bombs: 6,
            grid: [],
            openedCrystals: 0,
            currentMultiplier: 1,
            totalWin: 0,
        },
        coinflipState: {
            isFlipping: false,
        },
        rpsState: {
            isPlaying: false,
            choices: ['rock', 'paper', 'scissors'],
            choiceMap: { rock: '✊', paper: '✋', scissors: '✌️' }
        },
        slotsState: {
            isSpinning: false,
            symbols: [
                { name: 'Lemon', imageSrc: 'images/slot_lemon.png' },
                { name: 'Cherry', imageSrc: 'images/slot_cherry.png' },
                { name: 'Seven', imageSrc: 'images/slot_7.png' },
            ]
        },
        towerState: {
            isActive: false,
            isCashingOut: false,
            bet: 15,
            currentLevel: 0,
            levels: 5,
            grid: [],
            payouts: [],
            multipliers: [1.5, 2.5, 4, 8, 16]
        }
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
            
            loadInitialData();

        } catch (error) {
            console.error("Ошибка аутентификации:", error);
            showNotification('Не удалось подключиться к серверу.');
        }
    }
    
    async function loadUserInventory() {
        if (!STATE.user || !STATE.user.id) return;
        try {
            const response = await fetch(`/api/user/inventory?user_id=${STATE.user.id}`);
            if (!response.ok) throw new Error('Failed to load inventory');
            STATE.inventory = await response.json();
            
            if (document.getElementById('profile-view').classList.contains('active')) {
                renderInventory();
            }
        } catch (error) {
            console.error("Ошибка загрузки инвентаря:", error);
            showNotification('Не удалось загрузить инвентарь.');
        }
    }


    function loadTelegramData() {
        try {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            tg.BackButton.hide();
            const user = tg.initDataUnsafe.user;
            
            if (user && user.id) {
                if (UI.profilePhoto) UI.profilePhoto.src = user.photo_url || '';
                if (UI.profileName) UI.profileName.textContent = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                if (UI.profileId) UI.profileId.textContent = `ID ${user.id}`;
                authenticateUser(user);
            } else {
                 console.warn("Данные пользователя Telegram не найдены. Работа в режиме гостя.");
                 STATE.user = { id: 0, telegram_id: 0, username: "Guest", balance: 1000 };
                 if (UI.profileName) UI.profileName.textContent = "Guest";
                 if (UI.profileId) UI.profileId.textContent = "ID 0";
                 STATE.userBalance = 1000;
                 updateBalanceDisplay();
                 loadInitialData(); 
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
            const app_url = `https://t.me/qqtest134_bot/website?startapp=${user.id}`; // ЗАМЕНИТЕ НА ВАШУ ССЫЛКУ
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
            const app_url = `https://t.me/qqtest134_bot/website?startapp=${user.id}`; // ЗАМЕНИТЕ НА ВАШУ ССЫЛКУ
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
        const btnToActivate = document.querySelector(`.nav-btn[data-view="${viewId}"]`) || 
                              document.querySelector('.nav-btn[data-view="games-menu-view"]');
        
        if (viewToShow) viewToShow.classList.add('active');
        if (btnToActivate) btnToActivate.classList.add('active');

        if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.BackButton.offClick();
            const isGameScreen = ['upgrade-view', 'miner-view', 'coinflip-view', 'rps-view', 'slots-view', 'tower-view'].includes(viewId);
            
            if (isGameScreen) {
                tg.BackButton.show();
                tg.BackButton.onClick(() => switchView('games-menu-view'));
            } else if (viewId !== 'game-view') {
                 tg.BackButton.show();
                 tg.BackButton.onClick(() => switchView('game-view'));
            } else {
                tg.BackButton.hide();
            }
        }
        
        if (viewId === 'profile-view') {
            loadUserInventory();
            renderHistory();
        }
        if (viewId === 'upgrade-view') resetUpgradeState(true);
        if (viewId === 'contests-view') updateContestUI();
        if (viewId === 'miner-view') resetMinerGame();
        if(viewId === 'tower-view') resetTowerGame();
    }

    function renderInventory() {
        if (!UI.inventoryContent) return;
        UI.inventoryContent.innerHTML = '';
        if (STATE.inventory.length === 0) {
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
            itemEl.querySelector('.inventory-sell-btn').addEventListener('click', () => sellFromInventory(item.uniqueId));
            UI.inventoryContent.appendChild(itemEl);
        });
    }

    async function sellFromInventory(uniqueId) {
        if (!STATE.user || !STATE.user.id) {
            showNotification("Ошибка: пользователь не определен.");
            return;
        }
        try {
            const response = await fetch('/api/user/inventory/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: STATE.user.id, unique_id: uniqueId })
            });
            const result = await response.json();
            if (result.success) {
                STATE.userBalance = result.newBalance;
                updateBalanceDisplay();
                await loadUserInventory(); // Reload inventory from server
                showNotification("Предмет успешно продан!");
            } else {
                throw new Error(result.error || "Неизвестная ошибка при продаже");
            }
        } catch (error) {
            console.error("Ошибка при продаже предмета:", error);
            showNotification(`Ошибка: ${error.message}`);
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
        UI.priceCheckMessage.innerHTML = `⭐ ${totalCost.toLocaleString('ru-RU')}`;
        if (STATE.userBalance < totalCost) {
            UI.priceCheckMessage.innerHTML += ` (не хватает ${(totalCost - STATE.userBalance).toLocaleString('ru-RU')})`;
            UI.priceCheckMessage.classList.add('error');
            UI.startSpinBtn.disabled = true;
        } else {
            UI.priceCheckMessage.classList.remove('error');
            UI.startSpinBtn.disabled = false;
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
        if (STATE.userBalance < totalCost) {
            showNotification("Недостаточно средств.");
            return;
        }

        STATE.isSpinning = true;
        hideModal(UI.preOpenModal);

        try {
            const response = await fetch('/api/case/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: STATE.user.id, quantity: STATE.openQuantity })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Ошибка при открытии кейса');
            
            STATE.userBalance = result.newBalance;
            updateBalanceDisplay();
            STATE.lastWonItems = result.wonItems;
            STATE.gameHistory.push(...STATE.lastWonItems.map(item => ({ ...item, date: new Date(), name: `Выигрыш из кейса` })));

            UI.caseView.classList.add('hidden');
            UI.spinView.classList.remove('hidden');

            if (STATE.openQuantity > 1) {
                startMultiVerticalAnimation();
            } else {
                startHorizontalAnimation();
            }
        } catch(error) {
            console.error("Ошибка при открытии кейса:", error);
            showNotification(error.message);
            STATE.isSpinning = false;
        }
    }


    function startHorizontalAnimation() {
        UI.spinnerContainer.classList.remove('hidden');
        UI.multiSpinnerContainer.classList.add('hidden');

        const winnerItem = STATE.lastWonItems[0];
        const reel = Array.from({ length: 60 }, (_, i) => i === 50 ? winnerItem : STATE.possibleItems[Math.floor(Math.random() * STATE.possibleItems.length)]);

        UI.rouletteTrack.innerHTML = reel.map(item => `<div class="roulette-item"><img src="${item.imageSrc}" alt="${item.name}"></div>`).join('');
        
        const targetPosition = (50 * 130) + (130 / 2);
        UI.rouletteTrack.style.transition = 'none';
        UI.rouletteTrack.style.left = '0px';
        UI.rouletteTrack.getBoundingClientRect();
        UI.rouletteTrack.style.transition = `left ${STATE.isFastSpinEnabled ? '0.2s' : '6s'} cubic-bezier(0.2, 0.8, 0.2, 1)`;
        UI.rouletteTrack.style.left = `calc(50% - ${targetPosition}px)`;

        UI.rouletteTrack.addEventListener('transitionend', showResult, { once: true });
    }

    function startMultiVerticalAnimation() {
        UI.spinnerContainer.classList.add('hidden');
        UI.multiSpinnerContainer.classList.remove('hidden');
        UI.multiSpinnerContainer.innerHTML = '';
        let animationsFinished = 0;

        STATE.lastWonItems.forEach((winnerItem) => {
            const track = document.createElement('div');
            track.className = 'vertical-roulette-track';
            const reel = Array.from({ length: 60 }, (_, i) => i === 50 ? winnerItem : STATE.possibleItems[Math.floor(Math.random() * STATE.possibleItems.length)]);
            track.innerHTML = reel.map(item => `<div class="vertical-roulette-item"><img src="${item.imageSrc}" alt="${item.name}"></div>`).join('');
            
            const spinnerColumn = document.createElement('div');
            spinnerColumn.className = 'vertical-spinner';
            spinnerColumn.appendChild(track);
            UI.multiSpinnerContainer.appendChild(spinnerColumn);

            const targetPosition = (50 * 110) + (110 / 2);
            track.style.transition = 'none';
            track.style.top = '0px';
            track.getBoundingClientRect();
            const duration = (STATE.isFastSpinEnabled ? 0.2 : 5) + Math.random() * (STATE.isFastSpinEnabled ? 0.1 : 2);
            track.style.transition = `top ${duration}s cubic-bezier(0.2, 0.8, 0.2, 1)`;
            track.style.top = `calc(50% - ${targetPosition}px)`;

            track.addEventListener('transitionend', () => {
                animationsFinished++;
                if (animationsFinished === STATE.lastWonItems.length) showResult();
            }, { once: true });
        });
    }

    function showResult() {
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.innerHTML = `
            <button class="close-btn">✖</button>
            <h2 class="modal-case-title">Ваш выигрыш:</h2>
            <div class="result-items-container">
                ${STATE.lastWonItems.map(item => `
                    <div class="inventory-item">
                        <img src="${item.imageSrc}" alt="${item.name}">
                        <div class="inventory-item-name">${item.name}</div>
                        <div class="inventory-item-price">⭐ ${item.value.toLocaleString('ru-RU')}</div>
                    </div>`).join('')}
            </div>
            <div class="result-buttons">
                <button class="secondary-button" id="result-inventory-btn">В инвентарь</button>
                <button class="primary-button" id="result-spin-again-btn">Крутить еще</button>
            </div>
        `;
        UI.resultModal.innerHTML = '';
        UI.resultModal.appendChild(modalContent);
        
        const finalizeAction = () => {
            hideModal(UI.resultModal);
            UI.spinView.classList.add('hidden');
            UI.caseView.classList.remove('hidden');
            STATE.isSpinning = false;
            loadUserInventory(); // Refresh inventory
        };

        modalContent.querySelector('.close-btn').addEventListener('click', finalizeAction);
        modalContent.querySelector('#result-spin-again-btn').addEventListener('click', () => {
            finalizeAction();
            setTimeout(handleCaseClick, 100);
        });
        modalContent.querySelector('#result-inventory-btn').addEventListener('click', () => {
            finalizeAction();
            switchView('profile-view');
        });
        
        showModal(UI.resultModal);
    }


    function populateCasePreview() {
        if (!UI.caseContentsPreview) return;
        UI.caseContentsPreview.innerHTML = '';
        if (STATE.possibleItems.length === 0) {
            UI.caseContentsPreview.innerHTML = `<p class="inventory-empty-msg">Содержимое кейса пусто</p>`;
            return;
        }
        [...STATE.possibleItems].sort((a, b) => b.value - a.value).forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.classList.add('preview-item');
            itemEl.innerHTML = `<img src="${item.imageSrc}" alt="${item.name}"><div class="inventory-item-price">⭐ ${item.value.toLocaleString('ru-RU')}</div>`;
            UI.caseContentsPreview.appendChild(itemEl);
        });
    }

    // --- ЛОГИКА КОНКУРСОВ ---
    
    function updateContestUI() {
        if (!UI.contestsView || !UI.contestsView.classList.contains('active')) return;

        const contest = STATE.contest;
        if (!contest) {
            if (UI.contestCard) UI.contestCard.innerHTML = '<p class="inventory-empty-msg">Активных конкурсов сейчас нет.</p>';
            return;
        }

        if (!document.getElementById('contest-item-image')) {
            UI.contestCard.innerHTML = `
                <div class="contest-header">
                    <span class="contest-header__title">Конкурс за билеты</span>
                    <span class="contest-header__timer" id="contest-timer"></span>
                </div>
                <div class="contest-item">
                    <img src="" alt="Prize" class="contest-item__image" id="contest-item-image">
                    <div class="contest-item__info">
                        <div class="contest-item__name" id="contest-item-name"></div>
                        <div class="contest-item__meta">
                            <span>Твои билеты: <b id="user-tickets-display">0</b></span>
                            <span id="contest-participants">👥 0</span>
                            <a href="#" class="contest-item__link">Последние победители</a>
                        </div>
                    </div>
                </div>
                <div class="purchase-section">
                    <h3 class="purchase-section__title">Покупка билетов</h3>
                    <div class="purchase-controls">
                        <button class="primary-button" id="buy-ticket-btn">Купить билет</button>
                        <div class="quantity-control">
                            <button id="ticket-quantity-minus" class="quantity-control__btn">-</button>
                            <input type="text" id="ticket-quantity-input" class="quantity-control__input" value="1" readonly>
                            <button id="ticket-quantity-plus" class="quantity-control__btn">+</button>
                        </div>
                    </div>
                </div>`;
            
            document.getElementById('buy-ticket-btn').addEventListener('click', buyTickets);
            document.getElementById('ticket-quantity-plus').addEventListener('click', () => handleTicketQuantityChange(1));
            document.getElementById('ticket-quantity-minus').addEventListener('click', () => handleTicketQuantityChange(-1));
        }

        document.getElementById('contest-item-image').src = contest.item_imageSrc;
        document.getElementById('contest-item-name').textContent = contest.item_name;
        document.getElementById('user-tickets-display').textContent = contest.userTickets || 0;
        document.getElementById('contest-participants').innerHTML = `👥 ${contest.participants || 0}`;

        const buyBtn = document.getElementById('buy-ticket-btn');
        const quantityInput = document.getElementById('ticket-quantity-input');
        const totalCost = contest.ticket_price * STATE.ticketQuantity;
        
        buyBtn.innerHTML = `Купить (${STATE.ticketQuantity}) за ⭐ ${totalCost.toLocaleString('ru-RU')}`;
        quantityInput.value = STATE.ticketQuantity;
        buyBtn.disabled = STATE.userBalance < totalCost;
    }

    function handleTicketQuantityChange(amount) {
        const newQuantity = STATE.ticketQuantity + amount;
        if (newQuantity >= 1) {
            STATE.ticketQuantity = newQuantity;
            updateContestUI();
        }
    }

    async function buyTickets() {
        if (!STATE.contest || !STATE.user) return;
        const totalCost = STATE.contest.ticket_price * STATE.ticketQuantity;
        if (STATE.userBalance < totalCost) {
            showNotification('Недостаточно средств.');
            return;
        }

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

            if (result.success) {
                showNotification(`Вы успешно приобрели ${STATE.ticketQuantity} билет(ов)!`);
                STATE.userBalance = result.newBalance;
                
                if (STATE.contest) {
                    STATE.contest.userTickets = (STATE.contest.userTickets || 0) + STATE.ticketQuantity;
                    STATE.contest.count = (STATE.contest.count || 0) + STATE.ticketQuantity;
                }
                
                updateBalanceDisplay();
                updateContestUI();
            } else {
                throw new Error(result.error || 'Неизвестная ошибка');
            }
        } catch (error) {
            console.error("Ошибка при покупке билета:", error);
            showNotification(`Ошибка: ${error.message}`);
        }
    }
    
    let timerInterval = null;
    function setupTimer() {
        if (timerInterval) clearInterval(timerInterval);
        if(STATE.contest){
            updateTimer();
            timerInterval = setInterval(updateTimer, 1000);
        }
    }

    function updateTimer() {
        const contestTimerEl = document.getElementById('contest-timer');
        if (!contestTimerEl || !STATE.contest) {
            if(timerInterval) clearInterval(timerInterval);
            return;
        }

        const timeLeft = STATE.contest.end_time - Date.now();
        if (timeLeft <= 0) {
            contestTimerEl.textContent = 'Конкурс завершен';
            clearInterval(timerInterval);
            setTimeout(loadInitialData, 5000); 
            return;
        }
        const days = Math.floor(timeLeft / 86400000);
        const hours = Math.floor((timeLeft % 86400000) / 3600000);
        const minutes = Math.floor((timeLeft % 3600000) / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        contestTimerEl.textContent = `${days}д ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    // --- КОНЕЦ ЛОГИКИ КОНКУРСОВ ---

    // --- ЛОГИКА АПГРЕЙДА ---
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

    function handleUpgradeClick() {
        const { yourItem, desiredItem, chance, isUpgrading } = STATE.upgradeState;
        if (!yourItem || !desiredItem || isUpgrading) return;
        STATE.upgradeState.isUpgrading = true;
        UI.performUpgradeBtn.disabled = true;
        const isSuccess = (Math.random() * 100) < chance;
        const chanceAngle = (chance / 100) * 360;
        const randomOffset = Math.random() * 0.9 + 0.05;
        const stopPoint = isSuccess ? chanceAngle * randomOffset : chanceAngle + (360 - chanceAngle) * randomOffset;
        const rotation = (5 * 360) + stopPoint;
        STATE.upgradeState.currentRotation = rotation;

        UI.upgradePointer.style.transition = 'transform 6s cubic-bezier(0.2, 0.8, 0.2, 1)';
        UI.upgradePointer.style.transform = `translateX(-50%) rotate(${STATE.upgradeState.currentRotation}deg)`;

        UI.upgradePointer.addEventListener('transitionend', () => {
            setTimeout(() => {
                const itemIndex = STATE.inventory.findIndex(invItem => invItem.uniqueId === yourItem.uniqueId);
                if (itemIndex > -1) STATE.inventory.splice(itemIndex, 1);
                if (isSuccess) {
                    showNotification(`Апгрейд успешный! Вы получили ${desiredItem.name}.`);
                    const newItem = { ...desiredItem, uniqueId: Date.now() };
                    STATE.inventory.push(newItem);
                    STATE.gameHistory.push({ ...newItem, date: new Date(), name: `Апгрейд до ${newItem.name}`, value: newItem.value });
                } else {
                    showNotification(`К сожалению, апгрейд не удался. Предмет потерян.`);
                    STATE.gameHistory.push({ ...yourItem, date: new Date(), name: `Неудачный апгрейд ${yourItem.name}`, value: -yourItem.value });
                }
                resetUpgradeState(true);
                renderInventory();
                renderHistory();
            }, 1500);
        }, { once: true });
    }
    // --- КОНЕЦ ЛОГИКИ АПГРЕЙДА ---

    // --- ЛОГИКА МИНЕРА ---
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
        if (isNaN(bet) || bet <= 0) {
            showNotification("Некорректная ставка");
            return;
        }
        if (STATE.userBalance < bet) {
            showNotification("Недостаточно средств");
            return;
        }

        STATE.userBalance -= bet;
        updateBalanceDisplay();

        STATE.minerState.isActive = true;
        STATE.minerState.bet = bet;
        STATE.minerState.openedCrystals = 0;
        STATE.minerState.totalWin = 0;

        const totalCells = 12;
        const bombIndices = new Set();
        while (bombIndices.size < STATE.minerState.bombs) {
            bombIndices.add(Math.floor(Math.random() * totalCells));
        }

        STATE.minerState.grid = Array.from({ length: totalCells }, (_, i) => ({
            isBomb: bombIndices.has(i),
            isOpened: false,
        }));

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

            const totalCrystals = 12 - STATE.minerState.bombs;
            if (STATE.minerState.openedCrystals === totalCrystals) {
                endMinerGame(true);
            }
        }
    }

    function updateMinerMultiplierAndWin() {
        const { bet, openedCrystals } = STATE.minerState;
        if (openedCrystals === 0) {
            STATE.minerState.currentMultiplier = 1;
        } else {
            STATE.minerState.currentMultiplier = Math.pow(1.4, openedCrystals);
        }
        STATE.minerState.totalWin = bet * STATE.minerState.currentMultiplier;
    }

    function getNextWin() {
        const { bet, openedCrystals } = STATE.minerState;
        const nextMultiplier = Math.pow(1.4, openedCrystals + 1);
        return bet * nextMultiplier;
    }

    function updateMinerUI() {
        if (!UI.minerNextWin || !UI.minerTotalWin) return;

        if (STATE.minerState.isActive) {
            UI.minerNextWin.textContent = getNextWin().toFixed(2);
            if (STATE.minerState.openedCrystals > 0) {
                UI.minerTotalWin.textContent = STATE.minerState.totalWin.toFixed(2);
            } else {
                UI.minerTotalWin.textContent = '0';
            }
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
        } else {
            showNotification("Вы проиграли! Ставка сгорела.");
        }

        STATE.minerState.grid.forEach(cell => {
            if (cell.isBomb) cell.isOpened = true;
        });

        renderMinerGrid(false);
        setTimeout(resetMinerGame, 2000);
    }

    function cashoutMiner() {
        if (!STATE.minerState.isActive || STATE.minerState.openedCrystals === 0) return;
        endMinerGame(true);
    }
    // --- КОНЕЦ ЛОГИКИ МИНЕРА ---

    // --- ЛОГИКА СЛОТОВ ---
    function handleSlotsSpin() {
        if (!UI.slotsSpinBtn || STATE.slotsState.isSpinning) return;
        
        const bet = parseInt(UI.slotsBetInput.value);
        if (isNaN(bet) || bet <= 0) {
            showNotification("Некорректная ставка");
            return;
        }
        if (STATE.userBalance < bet) {
            showNotification("Недостаточно средств");
            return;
        }

        STATE.slotsState.isSpinning = true;
        UI.slotsSpinBtn.disabled = true;
        STATE.userBalance -= bet;
        updateBalanceDisplay();
        UI.slotsPayline.classList.remove('visible');

        const results = [];
        const tracks = [UI.slotsTrack1, UI.slotsTrack2, UI.slotsTrack3];
        let reelsFinished = 0;

        tracks.forEach((track, index) => {
            const symbols = STATE.slotsState.symbols;
            const reelLength = 30;
            const finalSymbol = symbols[Math.floor(Math.random() * symbols.length)];
            results[index] = finalSymbol;

            let reelHtml = '';
            for (let i = 0; i < reelLength; i++) {
                const symbol = i === reelLength - 2
                    ? finalSymbol
                    : symbols[Math.floor(Math.random() * symbols.length)];
                reelHtml += `<div class="slots-item"><img src="${symbol.imageSrc}" alt="${symbol.name}"></div>`;
            }
            track.innerHTML = reelHtml;

            track.style.transition = 'none';
            track.style.top = '0px';
            track.offsetHeight;

            const itemHeight = 90;
            const targetPosition = (reelLength - 2) * itemHeight;
            const spinDuration = 2.5 + index * 0.3;

            track.style.transition = `top ${spinDuration}s cubic-bezier(0.25, 1, 0.5, 1)`;
            track.style.top = `-${targetPosition}px`;

            track.addEventListener('transitionend', () => {
                reelsFinished++;
                if (reelsFinished === tracks.length) {
                    processSlotsResult(results, bet);
                }
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
            UI.slotsPayline.classList.add('visible');
            showNotification(message + ` (+${win.toFixed(0)} ⭐)`);
        } else {
            showNotification(message);
        }

        STATE.slotsState.isSpinning = false;
        UI.slotsSpinBtn.disabled = false;
    }
    // --- КОНЕЦ ЛОГИКИ СЛОТОВ ---

    // --- ЛОГИКА БАШНИ (TOWER) ---
    function resetTowerGame() {
        if (!UI.towerGameBoard) return;
        STATE.towerState.isActive = false;
        STATE.towerState.isCashingOut = false;
        STATE.towerState.currentLevel = 0;

        UI.towerGameBoard.innerHTML = '';
        UI.towerInitialControls.classList.remove('hidden');
        UI.towerCashoutControls.classList.add('hidden');
        UI.towerBetInput.disabled = false;
        UI.towerMaxWinDisplay.textContent = 'Возможный выигрыш: 0 ⭐';
    }

    function startTowerGame() {
        const bet = parseInt(UI.towerBetInput.value);
        if (isNaN(bet) || bet < 15) {
            showNotification("Минимальная ставка 15 ⭐");
            return;
        }
        if (STATE.userBalance < bet) {
            showNotification("Недостаточно средств");
            return;
        }

        STATE.userBalance -= bet;
        updateBalanceDisplay();

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
            rowEl.classList.add('tower-row');

            if (STATE.towerState.isActive && i === STATE.towerState.currentLevel) {
                rowEl.classList.add('active');
            }

            const payout = STATE.towerState.payouts[i] || 0;

            for (let j = 0; j < 2; j++) {
                const cell = document.createElement('div');
                cell.classList.add('tower-cell');
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
                        // Оставляем пустой, чтобы не показывать бомбу на пройденных уровнях
                    }
                }
                rowEl.appendChild(cell);
            }
            UI.towerGameBoard.appendChild(rowEl);
        }
    }

    function handleTowerCellClick(row, col) {
        if (!STATE.towerState.isActive || row !== STATE.towerState.currentLevel) return;

        STATE.towerState.isActive = false;

        const bombCol = STATE.towerState.grid[row];
        const clickedRowEl = UI.towerGameBoard.children[STATE.towerState.levels - 1 - row]; 
        const cells = clickedRowEl.querySelectorAll('.tower-cell');

        cells.forEach((c, c_index) => {
            if (c_index === bombCol) {
                c.classList.add('danger');
                c.innerHTML = `<img src="images/bomb.png" alt="Lose">`;
            } else {
                c.classList.add('safe');
                c.innerHTML = `<img src="images/diamond.png" alt="Win">`;
            }
        });
        clickedRowEl.classList.remove('active');

        if (col === bombCol) {
            setTimeout(() => endTowerGame(false), 1200);
        } else {
            STATE.towerState.currentLevel++;
            const cashoutAmount = STATE.towerState.payouts[STATE.towerState.currentLevel - 1];

            UI.towerCashoutBtn.textContent = `Забрать ${cashoutAmount.toLocaleString('ru-RU')} ⭐`;
            UI.towerCashoutBtn.disabled = false;

            if (STATE.towerState.currentLevel === STATE.towerState.levels) {
                setTimeout(() => endTowerGame(true), 1200);
            } else {
                setTimeout(() => {
                    STATE.towerState.isActive = true;
                    renderTower();
                }, 800);
            }
        }
    }

    function endTowerGame(isWin) {
        STATE.towerState.isActive = false;
        let winAmount = 0;

        if (isWin && STATE.towerState.currentLevel > 0) {
            winAmount = STATE.towerState.payouts[STATE.towerState.currentLevel - 1];
            STATE.userBalance += winAmount;
            updateBalanceDisplay();
            showNotification(`Выигрыш ${winAmount.toLocaleString('ru-RU')} ⭐ зачислен!`);
        } else {
            showNotification("Вы проиграли! Ставка сгорела.");
            for(let i = STATE.towerState.currentLevel; i < STATE.towerState.levels; i++) {
                const rowEl = UI.towerGameBoard.children[STATE.towerState.levels - 1 - i];
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
        STATE.towerState.isCashingOut = true;
        endTowerGame(true);
    }
    // --- КОНЕЦ ЛОГИКИ БАШНИ ---

    // --- ЛОГИКА ОРЛА И РЕШКИ ---
    function handleCoinflip(playerChoice) {
        if (!UI.coin || STATE.coinflipState.isFlipping) return;
        
        const bet = parseInt(UI.coinflipBetInput.value);
        if (isNaN(bet) || bet <= 0) {
            showNotification("Некорректная ставка");
            return;
        }
        if (STATE.userBalance < bet) {
            showNotification("Недостаточно средств");
            return;
        }

        STATE.coinflipState.isFlipping = true;
        UI.coinflipResult.textContent = '';
        STATE.userBalance -= bet;
        updateBalanceDisplay();

        const result = Math.random() < 0.5 ? 'heads' : 'tails';

        const handleFlipEnd = () => {
            if (playerChoice === result) {
                STATE.userBalance += bet * 2;
                UI.coinflipResult.textContent = `Вы выиграли ${bet} ⭐!`;
                showNotification(`Победа!`);
            } else {
                UI.coinflipResult.textContent = `Вы проиграли ${bet} ⭐.`;
                showNotification(`Проигрыш!`);
            }
            updateBalanceDisplay();
            STATE.coinflipState.isFlipping = false;

            UI.coin.style.transition = 'none';
            if (result === 'tails') {
                UI.coin.style.transform = 'rotateY(180deg)';
            } else {
                UI.coin.style.transform = 'rotateY(0deg)';
            }
        };

        UI.coin.addEventListener('transitionend', handleFlipEnd, { once: true });

        UI.coin.style.transition = 'transform 1s cubic-bezier(0.5, 1.3, 0.5, 1.3)';

        const currentRotation = UI.coin.style.transform;
        const isTailsUp = currentRotation.includes('180');
        const baseRotation = isTailsUp ? 180 : 0;
        const fullSpins = 5 * 360;

        if (result === 'heads') {
            UI.coin.style.transform = `rotateY(${baseRotation + fullSpins}deg)`;
        } else {
            UI.coin.style.transform = `rotateY(${baseRotation + fullSpins + 180}deg)`;
        }
    }
    // --- КОНЕЦ ЛОГИКИ ОРЛА И РЕШКИ ---

    // --- ЛОГИКА КАМЕНЬ-НОЖНИЦЫ-БУМАГА ---
    function handleRps(playerChoice) {
        if (!UI.rpsComputerChoice || STATE.rpsState.isPlaying) return;

        const bet = parseInt(UI.rpsBetInput.value);
        if (isNaN(bet) || bet <= 0) {
            showNotification("Некорректная ставка");
            return;
        }
        if (STATE.userBalance < bet) {
            showNotification("Недостаточно средств");
            return;
        }

        STATE.rpsState.isPlaying = true;
        UI.rpsButtons.forEach(button => button.disabled = true);
        UI.rpsPlayerChoice.textContent = STATE.rpsState.choiceMap[playerChoice];
        UI.rpsResultMessage.textContent = '';

        const computerChoice = STATE.rpsState.choices[Math.floor(Math.random() * STATE.rpsState.choices.length)];

        const reelLength = 60, winnerIndex = 50;
        const reel = Array.from({ length: reelLength }, (_, i) => {
            const symbolKey = i === winnerIndex ? computerChoice : STATE.rpsState.choices[Math.floor(Math.random() * STATE.rpsState.choices.length)];
            return STATE.rpsState.choiceMap[symbolKey];
        });

        const track = UI.rpsComputerChoice.querySelector('.rps-roulette-track');
        track.innerHTML = '';
        reel.forEach(symbol => {
            const itemEl = document.createElement('div');
            itemEl.classList.add('rps-roulette-item');
            itemEl.textContent = symbol;
            track.appendChild(itemEl);
        });

        const itemWidth = 120, itemMargin = 5, totalItemWidth = itemWidth + (itemMargin * 2);
        const targetPosition = (winnerIndex * totalItemWidth) + (totalItemWidth / 2);

        const onSpinEnd = () => {
            let resultMessage = '';
            if (playerChoice === computerChoice) {
                resultMessage = "Ничья!";
                STATE.userBalance += bet; // Возвращаем ставку
            } else if (
                (playerChoice === 'rock' && computerChoice === 'scissors') ||
                (playerChoice === 'paper' && computerChoice === 'rock') ||
                (playerChoice === 'scissors' && computerChoice === 'paper')
            ) {
                resultMessage = `Вы выиграли ${bet} ⭐!`;
                STATE.userBalance += bet * 2;
                showNotification(`Победа!`);
            } else {
                resultMessage = `Вы проиграли ${bet} ⭐.`;
                showNotification(`Проигрыш!`);
            }

            UI.rpsResultMessage.textContent = resultMessage;
            updateBalanceDisplay();

            setTimeout(() => {
                STATE.rpsState.isPlaying = false;
                UI.rpsButtons.forEach(button => button.disabled = false);
            }, 1500);
        };

        track.addEventListener('transitionend', onSpinEnd, { once: true });

        track.style.transition = 'none';
        track.style.left = '0px';
        track.getBoundingClientRect();
        track.style.transition = 'left 6s cubic-bezier(0.2, 0.8, 0.2, 1)';
        track.style.left = `calc(50% - ${targetPosition}px)`;
    }
    // --- КОНЕЦ ЛОГИКИ КАМЕНЬ-НОЖНИЦЫ-БУМАГА ---


    // --- ЗАГРУЗКА ДАННЫХ С СЕРВЕРА ---
    async function loadInitialData() {
        if (!STATE.user) {
            console.error("Пользователь не аутентифицирован. Загрузка данных отменена.");
            return;
        }
        try {
            const [caseResponse, settingsResponse, contestResponse] = await Promise.all([
                fetch('/api/case/items'),
                fetch('/api/game_settings'),
                fetch(`/api/contest/current?telegram_id=${STATE.user.telegram_id}`)
            ]);

            if (!caseResponse.ok) throw new Error(`Ошибка загрузки кейсов: ${caseResponse.status}`);
            if (!settingsResponse.ok) throw new Error(`Ошибка загрузки настроек: ${settingsResponse.status}`);
            if (!contestResponse.ok) throw new Error(`Ошибка загрузки конкурса: ${contestResponse.status}`);
            
            STATE.possibleItems = await caseResponse.json();
            STATE.gameSettings = await settingsResponse.json();
            STATE.contest = await contestResponse.json();

            applyGameSettings();
            populateCasePreview();
            updateContestUI();
            setupTimer();
            loadUserInventory();

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
                btn.style.display = (gameButtons[view] === 'false') ? 'none' : '';
            }
        });
    }

    // --- ИНИЦИАЛИЗАЦИЯ ---
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
            contestsView: '#contests-view', contestCard: '.contest-card',
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
            rpsPlayerChoice: '#rps-player-choice', rpsComputerChoice: '.rps-spinner-container',
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
            const elements = document.querySelectorAll(selectors[key]);
            UI[key] = elements.length > 1 ? elements : elements[0];
        }

        if (UI.caseImageBtn) UI.caseImageBtn.addEventListener('click', handleCaseClick);
        if (UI.startSpinBtn) UI.startSpinBtn.addEventListener('click', startSpinProcess);
        if (UI.quantitySelector) UI.quantitySelector.addEventListener('click', handleQuantityChange);
        if (UI.fastSpinToggle) UI.fastSpinToggle.addEventListener('change', (event) => STATE.isFastSpinEnabled = event.target.checked);
        if (UI.navButtons) UI.navButtons.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
        if (UI.inviteFriendBtn) UI.inviteFriendBtn.addEventListener('click', inviteFriend);
        if (UI.copyLinkBtn) UI.copyLinkBtn.addEventListener('click', copyInviteLink);
        
        if (UI.profileTabs) UI.profileTabs.forEach(tab => tab.addEventListener('click', function () {
            UI.profileTabs.forEach(t => t.classList.remove('active'));
            UI.profileContents.forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(this.dataset.tab + '-content').classList.add('active');
        }));
        if (UI.modalOverlay) UI.modalOverlay.addEventListener('click', () => document.querySelectorAll('.modal.visible').forEach(hideModal));
        const preOpenModalCloseBtn = document.querySelector('[data-close-modal="pre-open-modal"]');
        if (preOpenModalCloseBtn) preOpenModalCloseBtn.addEventListener('click', () => hideModal(UI.preOpenModal));
        
        if (UI.pickerTabs) UI.pickerTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                if (STATE.upgradeState.isUpgrading) return;
                UI.pickerTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                STATE.upgradeState.activePicker = tab.dataset.picker;
                if(UI.yourItemSlot) UI.yourItemSlot.classList.toggle('active-selection', STATE.upgradeState.activePicker === 'inventory');
                if(UI.desiredItemSlot) UI.desiredItemSlot.classList.toggle('active-selection', STATE.upgradeState.activePicker === 'desired');
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
        switchView('game-view');
    }
    
    try {
        init();
    } catch (error) {
        console.error("Критическая ошибка при инициализации:", error);
        document.body.innerHTML = `<div style="color: white; padding: 20px;">Произошла критическая ошибка: ${error.message}. Пожалуйста, проверьте консоль (F12) для деталей.</div>`;
    }
});
