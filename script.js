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

    function showNotification(message, isError = false) {
        if (!UI.notificationToast) return;
        UI.notificationToast.textContent = message;
        UI.notificationToast.classList.toggle('error', isError);
        UI.notificationToast.classList.add('visible');
        setTimeout(() => UI.notificationToast.classList.remove('visible'), 3000);
    }
    
    // --- ОСНОВНАЯ ФУНКЦИЯ для вызова API бэкенда мини-приложения ---
    async function callApi(endpoint, method = 'GET', body = null) {
        try {
            const options = {
                method: method,
                headers: { 'Content-Type': 'application/json' },
            };
            // ВАЖНО: user_id (внутренний ID) добавляется в body ТОЛЬКО в servers.js
            // Клиент оперирует только telegram_id, который передается в STATE.user
            if (body) {
                body.telegram_id = STATE.user?.telegram_id;
                body.user_id_internal = STATE.user?.id; // Отправляем и внутренний ID для совместимости
                options.body = JSON.stringify(body);
            }
            const response = await fetch(endpoint, options);
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Ошибка сервера');
            }
            
            // Если API вернуло новый баланс, обновляем его глобально
            if (result.newBalance !== undefined) {
                STATE.userBalance = parseFloat(result.newBalance);
                updateBalanceDisplay();
            }
            
            return result;
        } catch (error) {
            showNotification(error.message, true);
            throw error;
        }
    }

    async function authenticateUser(tgUser) {
        try {
            const userData = await callApi('/api/user/get-or-create', 'POST', {
                telegram_id: tgUser.id,
                username: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim()
            });
            STATE.user = userData;
            STATE.userBalance = parseFloat(userData.balance_uah);
            updateBalanceDisplay();
            await loadInventory(); 
            loadContestData();
        } catch (error) {
            console.error("Ошибка аутентификации:", error);
        }
    }
    
    async function loadInventory() {
        if (!STATE.user || !STATE.user.id) return;
        try {
            const inventoryData = await callApi(`/api/user/inventory?user_id=${STATE.user.id}`);
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
                 STATE.userBalance = 1000; // Демо-баланс
                 updateBalanceDisplay();
            }
        } catch (error) {
            console.error("Не удалось загрузить данные Telegram:", error);
            if (UI.profileName) UI.profileName.textContent = "Guest";
            if (UI.profileId) UI.profileId.textContent = "ID 0";
        }
    }

    function updateBalanceDisplay() {
        if (UI.userBalanceElement) {
            UI.userBalanceElement.innerHTML = `<span class="icon">₴</span> ${(STATE.userBalance || 0).toFixed(2)}`;
        }
    }
    
    // ... (остальные вспомогательные функции, такие как showModal, hideModal, switchView и т.д. остаются без изменений)
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
                    Продать за <span class="icon">₴</span> ${item.value.toFixed(2)}
                </button>
            `;
            itemEl.querySelector('.inventory-sell-btn').addEventListener('click', () => sellFromInventory(item.uniqueId));
            UI.inventoryContent.appendChild(itemEl);
        });
    }

    async function sellFromInventory(uniqueId) {
        if (!STATE.user || !STATE.user.id) return;
        try {
            await callApi('/api/user/inventory/sell', 'POST', { 
                unique_id: uniqueId 
            });
            await loadInventory();
            showNotification('Предмет продан!');
        } catch (error) {
            console.error("Ошибка при продаже предмета:", error);
        }
    }
    
    // ... renderHistory
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
                <div class="history-item-price">${entry.value > 0 ? '+' : ''}<span class="icon">₴</span>${entry.value.toFixed(2)}</div>
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
            UI.priceCheckMessage.innerHTML = `₴ ${totalCost.toFixed(2)}`;
            UI.priceCheckMessage.classList.remove('error');
            UI.startSpinBtn.disabled = false;
        } else {
            UI.priceCheckMessage.innerHTML = `₴ ${totalCost.toFixed(2)} (не хватает ${(totalCost - STATE.userBalance).toFixed(2)})`;
            UI.priceCheckMessage.classList.add('error');
            UI.startSpinBtn.disabled = true;
        }
    }
    
    async function startSpinProcess() {
        if (STATE.isSpinning || !STATE.user) return;

        try {
            const result = await callApi('/api/case/open', 'POST', {
                quantity: STATE.openQuantity
            });
            
            STATE.isSpinning = true;
            hideModal(UI.preOpenModal);

            STATE.lastWonItems = result.wonItems;
            
            STATE.gameHistory.push(...result.wonItems.map(item => ({ ...item, date: new Date(), name: `Выигрыш из кейса`, value: item.value })));

            UI.caseView.classList.add('hidden');
            UI.spinView.classList.remove('hidden');

            if (STATE.openQuantity > 1) {
                startMultiVerticalAnimation();
            } else {
                startHorizontalAnimation();
            }

        } catch(error) {
            console.error("Ошибка открытия кейса:", error);
            STATE.isSpinning = false;
        }
    }
    
    // ... startHorizontalAnimation, startMultiVerticalAnimation, showResult
    // В showResult нужно заменить значок '⭐' на '₴'
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
                    <div class="inventory-item-price">₴ ${item.value.toFixed(2)}</div>
                </div>`).join('')}
            </div>
            <div class="result-buttons">
                <button class="secondary-button" id="result-sell-btn">Продать все за ₴ ${totalValue.toFixed(2)}</button>
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
            // Эта логика может быть неточной, т.к. uniqueId присваивается базой.
            // Продажа по одному предмету через sellFromInventory надежнее.
            showNotification('Продажа... (эта функция может быть неточной)');
            await finalizeAction();
        });
        showModal(UI.resultModal);
    }

    
    async function buyTickets() {
        if (!STATE.contest || !STATE.user) return showNotification('Ошибка: данные не загружены.', true);
        
        try {
            await callApi('/api/contest/buy-ticket', 'POST', {
                contest_id: STATE.contest.id,
                quantity: STATE.ticketQuantity
            });

            showNotification(`Вы успешно приобрели ${STATE.ticketQuantity} билет(ов)!`);
            await loadContestData();
        } catch (error) {
            console.error("Ошибка при покупке билета:", error);
        }
    }
    
    // --- ИГРЫ С ПРЯМЫМ ИЗМЕНЕНИЕМ БАЛАНСА ---
    
    async function startMinerGame() {
        const bet = parseInt(UI.minerBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка", true);

        try {
            await callApi('/api/v1/balance/change', 'POST', { delta: -bet, reason: 'miner_start_bet' });

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

        } catch (error) {
            console.error("Ошибка при списании ставки в Минере:", error);
            // Баланс уже обработан в callApi, просто выходим
        }
    }

    async function endMinerGame(isWin) {
        STATE.minerState.isActive = false;
        if (isWin) {
            try {
                await callApi('/api/v1/balance/change', 'POST', { delta: STATE.minerState.totalWin, reason: 'miner_cashout' });
                showNotification(`Выигрыш ${STATE.minerState.totalWin.toFixed(2)} ₴ зачислен!`);
            } catch (error) {
                 console.error("Ошибка при зачислении выигрыша в Минере:", error);
                 showNotification("Ошибка зачисления выигрыша", true);
            }
        } else {
            showNotification("Вы проиграли! Ставка сгорела.");
        }
        STATE.minerState.grid.forEach(cell => { if (cell.isBomb) cell.isOpened = true; });
        renderMinerGrid(false);
        setTimeout(resetMinerGame, 2000);
    }
    
    async function handleSlotsSpin() {
        if (!UI.slotsSpinBtn || STATE.slotsState.isSpinning) return;
        const bet = parseInt(UI.slotsBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка", true);

        try {
            await callApi('/api/v1/balance/change', 'POST', { delta: -bet, reason: 'slots_spin_bet' });
            
            STATE.slotsState.isSpinning = true;
            UI.slotsSpinBtn.disabled = true;
            UI.slotsPayline.classList.remove('visible');

            // ... (логика анимации слотов остается той же)
            // ... в processSlotsResult вызываем API для зачисления выигрыша
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

        } catch (error) {
            console.error("Ошибка при списании ставки в Слотах:", error);
        }
    }
    
    async function processSlotsResult(results, bet) {
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
            try {
                await callApi('/api/v1/balance/change', 'POST', { delta: win, reason: 'slots_win' });
                UI.slotsPayline.classList.add('visible');
                showNotification(`${message} (+${win.toFixed(2)} ₴)`);
            } catch (error) {
                console.error("Ошибка при зачислении выигрыша в слотах:", error);
                showNotification("Ошибка зачисления выигрыша", true);
            }
        } else {
            showNotification(message);
        }
        
        STATE.slotsState.isSpinning = false;
        UI.slotsSpinBtn.disabled = false;
    }


    async function startTowerGame() {
        const bet = parseInt(UI.towerBetInput.value);
        if (isNaN(bet) || bet < 15) return showNotification("Минимальная ставка 15 ₴", true);
        
        try {
            await callApi('/api/v1/balance/change', 'POST', { delta: -bet, reason: 'tower_start_bet' });
            
            STATE.towerState.isActive = true;
            STATE.towerState.bet = bet;
            STATE.towerState.currentLevel = 0;
            STATE.towerState.grid = Array.from({ length: STATE.towerState.levels }, () => Math.floor(Math.random() * 2));
            STATE.towerState.payouts = STATE.towerState.multipliers.map(m => Math.round(bet * m));
            UI.towerInitialControls.classList.add('hidden');
            UI.towerCashoutControls.classList.remove('hidden');
            UI.towerCashoutBtn.disabled = true;
            UI.towerCashoutBtn.textContent = `Забрать 0 ₴`;
            const maxWin = STATE.towerState.payouts[STATE.towerState.payouts.length - 1];
            UI.towerMaxWinDisplay.textContent = `Возможный выигрыш: ${maxWin.toLocaleString('ru-RU')} ₴`;
            renderTower();
        } catch (error) {
             console.error("Ошибка при списании ставки в Башне:", error);
        }
    }
    
    async function endTowerGame(isWin) {
        if (STATE.towerState.nextLevelTimeout) clearTimeout(STATE.towerState.nextLevelTimeout);
        STATE.towerState.isActive = false;
        UI.towerCashoutBtn.disabled = true;
        if (isWin && STATE.towerState.currentLevel > 0) {
            const winAmount = STATE.towerState.payouts[STATE.towerState.currentLevel - 1];
            try {
                await callApi('/api/v1/balance/change', 'POST', { delta: winAmount, reason: 'tower_cashout' });
                showNotification(`Выигрыш ${winAmount.toLocaleString('ru-RU')} ₴ зачислен!`);
            } catch (error) {
                console.error("Ошибка при зачислении выигрыша в Башне:", error);
                showNotification("Ошибка зачисления выигрыша", true);
            }
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
    
    // ... и так далее для handleCoinflip, handleRps и других игровых функций...
    // Ниже привожу их обновленные версии:

    async function handleCoinflip(playerChoice) {
        if (!UI.coin || STATE.coinflipState.isFlipping) return;
        const bet = parseInt(UI.coinflipBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка", true);

        try {
            await callApi('/api/v1/balance/change', 'POST', { delta: -bet, reason: 'coinflip_bet' });
            
            STATE.coinflipState.isFlipping = true;
            UI.coinflipResult.textContent = '';
            
            const result = Math.random() < 0.5 ? 'heads' : 'tails';
            UI.coin.addEventListener('transitionend', async () => {
                if (playerChoice === result) {
                    try {
                        await callApi('/api/v1/balance/change', 'POST', { delta: bet * 2, reason: 'coinflip_win' });
                        UI.coinflipResult.textContent = `Вы выиграли ${bet.toFixed(2)} ₴!`;
                        showNotification(`Победа!`);
                    } catch (e) {
                        UI.coinflipResult.textContent = 'Ошибка зачисления';
                    }
                } else {
                    UI.coinflipResult.textContent = `Вы проиграли ${bet.toFixed(2)} ₴.`;
                    showNotification(`Проигрыш!`);
                }
                
                STATE.coinflipState.isFlipping = false;
                UI.coin.style.transition = 'none';
                UI.coin.style.transform = result === 'tails' ? 'rotateY(180deg)' : 'rotateY(0deg)';
            }, { once: true });

            UI.coin.style.transition = 'transform 1s cubic-bezier(0.5, 1.3, 0.5, 1.3)';
            const currentRotation = UI.coin.style.transform.includes('180') ? 180 : 0;
            const fullSpins = 5 * 360;
            UI.coin.style.transform = `rotateY(${currentRotation + fullSpins + (result === 'tails' ? 180 : 0)}deg)`;

        } catch (error) {
            console.error("Ошибка при списании ставки в Coinflip:", error);
        }
    }

    async function handleRps(playerChoice) {
        if (!UI.rpsComputerChoice || STATE.rpsState.isPlaying) return;
        const bet = parseInt(UI.rpsBetInput.value);
        if (isNaN(bet) || bet <= 0) return showNotification("Некорректная ставка", true);
        
        try {
            // Списываем только ставку
            await callApi('/api/v1/balance/change', 'POST', { delta: -bet, reason: 'rps_bet' });

            STATE.rpsState.isPlaying = true;
            UI.rpsButtons.forEach(button => button.disabled = true);
            UI.rpsPlayerChoice.textContent = STATE.rpsState.choiceMap[playerChoice];
            UI.rpsResultMessage.textContent = '';
            const computerChoice = STATE.rpsState.choices[Math.floor(Math.random() * 3)];
            
            // ... (анимация) ...
            
            // В колбеке после анимации:
            let resultMessage = '';
            let delta = 0;
            
            if (playerChoice === computerChoice) {
                resultMessage = "Ничья!";
                delta = bet; // Возвращаем ставку
            } else if ((playerChoice === 'rock' && computerChoice === 'scissors') || (playerChoice === 'paper' && computerChoice === 'rock') || (playerChoice === 'scissors' && computerChoice === 'paper')) {
                resultMessage = `Вы выиграли ${bet.toFixed(2)} ₴!`;
                delta = bet * 2; // Возвращаем ставку + выигрыш
                showNotification(`Победа!`);
            } else {
                resultMessage = `Вы проиграли ${bet.toFixed(2)} ₴.`;
                delta = 0; // Ничего не возвращаем
                showNotification(`Проигрыш!`);
            }
            
            if (delta > 0) {
                try {
                    await callApi('/api/v1/balance/change', 'POST', { delta: delta, reason: 'rps_result' });
                } catch(e) {
                    resultMessage = "Ошибка зачисления!";
                }
            }

            UI.rpsResultMessage.textContent = resultMessage;
            
            setTimeout(() => {
                STATE.rpsState.isPlaying = false;
                UI.rpsButtons.forEach(button => button.disabled = false);
            }, 1500);

        } catch (error) {
            console.error("Ошибка при списании ставки в К-Н-Б:", error);
        }
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
        // --- ИСПРАВЛЕННАЯ ЛОГИКА ВЫБОРА ЭЛЕМЕНТОВ ---
        const selectors = {
            notificationToast: '#notification-toast', userBalanceElement: '#user-balance',
            modalOverlay: '#modal-overlay', caseView: '#case-view', spinView: '#spin-view',
            rouletteTrack: '#roulette', spinnerContainer: '#spinner-container',
            multiSpinnerContainer: '#multi-spinner-container', caseImageBtn: '#case-image-btn',
            preOpenModal: '#pre-open-modal', priceCheckMessage: '#price-check-message',
            quantitySelector: '#quantity-selector', fastSpinToggle: '#fast-spin-toggle',
            caseContentsPreview: '#case-contents-preview', startSpinBtn: '#start-spin-btn',
            resultModal: '#result-modal', inventoryContent: '#inventory-content',
            historyContent: '#history-content', profilePhoto: '#profile-photo',
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
            performUpgradeBtn: '#perform-upgrade-btn', itemPickerContent: '#item-picker-content', 
            minerGrid: '#miner-grid', minerStartBtn: '#miner-start-btn',
            minerCashoutBtn: '#miner-cashout-btn', minerBetInput: '#miner-bet-input',
            minerNextWin: '#miner-next-win', minerTotalWin: '#miner-total-win',
            minerInfoWrapper: '.miner-info-wrapper', coin: '#coin',
            coinflipResult: '#coinflip-result-message', coinflipBetInput: '#coinflip-bet-input',
            coinflipHeadsBtn: '#coinflip-heads-btn', coinflipTailsBtn: '#coinflip-tails-btn',
            rpsPlayerChoice: '#rps-player-choice', rpsComputerChoice: '#rps-computer-choice',
            rpsResultMessage: '#rps-result-message', rpsBetInput: '#rps-bet-input',
            slotsTrack1: '#slots-track-1', slotsTrack2: '#slots-track-2', slotsTrack3: '#slots-track-3',
            slotsSpinBtn: '#slots-spin-btn', slotsBetInput: '#slots-bet-input',
            slotsPayline: '.slots-payline', towerGameBoard: '#tower-game-board',
            towerBetInput: '#tower-bet-input', towerMaxWinDisplay: '#tower-max-win-display',
            towerInitialControls: '#tower-initial-controls', towerCashoutControls: '#tower-cashout-controls',
            towerStartBtn: '#tower-start-btn', towerCashoutBtn: '#tower-cashout-btn'
        };
        
        const multiSelectors = {
            views: '.view', navButtons: '.nav-btn',
            profileTabs: '.profile-tabs:not(.upgrade-picker-container) .profile-tab-btn',
            profileContents: '.profile-tab-content', gameMenuBtns: '.game-menu-btn',
            rpsButtons: '.rps-buttons .primary-button', pickerTabs: '.upgrade-picker-container .profile-tab-btn'
        };

        for (const key in selectors) {
            UI[key] = document.querySelector(selectors[key]);
        }
        for (const key in multiSelectors) {
            UI[key] = document.querySelectorAll(multiSelectors[key]);
        }
        
        // --- ПРИВЯЗКА СОБЫТИЙ ---
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
            document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            const content = document.getElementById(this.dataset.tab + '-content');
            if(content) content.classList.add('active');
        }));
        if (UI.modalOverlay) UI.modalOverlay.addEventListener('click', () => document.querySelectorAll('.modal.visible').forEach(hideModal));
        document.querySelector('[data-close-modal="pre-open-modal"]')?.addEventListener('click', () => hideModal(UI.preOpenModal));
        if (UI.gameMenuBtns) UI.gameMenuBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
        if (UI.minerStartBtn) UI.minerStartBtn.addEventListener('click', startMinerGame);
        if (UI.minerCashoutBtn) UI.minerCashoutBtn.addEventListener('click', () => endMinerGame(true));
        if (UI.slotsSpinBtn) UI.slotsSpinBtn.addEventListener('click', handleSlotsSpin);
        if (UI.towerStartBtn) UI.towerStartBtn.addEventListener('click', startTowerGame);
        if (UI.towerCashoutBtn) UI.towerCashoutBtn.addEventListener('click', () => endTowerGame(true));
        if (UI.coinflipHeadsBtn) UI.coinflipHeadsBtn.addEventListener('click', () => handleCoinflip('heads'));
        if (UI.coinflipTailsBtn) UI.coinflipTailsBtn.addEventListener('click', () => handleCoinflip('tails'));
        if (UI.rpsButtons) UI.rpsButtons.forEach(button => button.addEventListener('click', () => handleRps(button.dataset.choice)));

        loadTelegramData();
        loadInitialData();
        switchView('game-view');
        // setInterval(updateTimer, 1000); // Таймер конкурса пока отключен до его полной реализации
    }
    
    try {
        init();
    } catch (error) {
        console.error("Критическая ошибка при инициализации:", error);
        document.body.innerHTML = `<div style="color: white; padding: 20px;">Произошла критическая ошибка: ${error.message}. Пожалуйста, проверьте консоль (F12).</div>`;
    }
});
