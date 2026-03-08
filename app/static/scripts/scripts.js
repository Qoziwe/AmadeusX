document.addEventListener("DOMContentLoaded", () => {
  // --- CSRF Token Helper ---
  function getCSRFToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    return metaTag ? metaTag.getAttribute('content') : '';
  }

  // --- Общая логика для переключения форм авторизации ---
  const tabs = document.querySelectorAll(".auth__tab");
  const forms = document.querySelectorAll(".auth__form");

  tabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      const targetForm = this.dataset.tab;

      tabs.forEach((t) => t.classList.remove("auth__tab--active"));
      forms.forEach((f) => f.classList.remove("auth__form--active"));

      this.classList.add("auth__tab--active");
      document
        .getElementById(targetForm + "-form")
        .classList.add("auth__form--active");
    });
  });

  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get("mode");

  if (mode === "login") {
    document.querySelector('[data-tab="login"]')?.click();
  } else if (mode === "register") {
    document.querySelector('[data-tab="register"]')?.click();
  }

  // --- Логика для home.html ---
  const userSearchInput = document.getElementById("user-search-input");
  const userSearchButton = document.getElementById("user-search-button");
  const searchResultsDiv = document.getElementById("search-results");
  const pendingInvitationsDiv = document.getElementById("pending-invitations");
  const noInvitationsMessage = document.getElementById(
    "no-invitations-message"
  );
  const userChatsDiv = document.getElementById("user-chats");
  const noChatsMessage = document.getElementById("no-chats-message");

  // Элементы модального окна (теперь они в base.html, доступны глобально)
  const keyModal = document.getElementById("key-modal");
  const encryptionKeyInput = document.getElementById("encryption-key-input");
  const confirmKeyButton = document.getElementById("confirm-key-button");
  const keyModalError = document.getElementById("key-modal-error");

  // --- SocketIO Client Setup ---
  const io = window.io;
  const socket = io(window.location.origin, {
  	transports: ["websocket"],
  	secure: window.location.protocol === 'https:',
  	withCredentials: true,
 	 reconnectionAttempts: 5
  });

  // Вспомогательная функция для fetch с CSRF
  function secureFetch(url, options = {}) {
    const headers = options.headers || {};
    headers['X-CSRFToken'] = getCSRFToken();
    return fetch(url, { ...options, headers });
  }

  socket.on("connect", () => {
    socket.emit("join_user_room", {user_id: CURRENT_USER_ID});
  });

  socket.on("connect_error", (err) => {
    // Ошибка подключения — не логируем в консоль
  });


  // --- Вспомогательная функция для создания аватара (для динамических элементов) ---
  function createAvatarElement(username, avatarUrl, className) {
    const avatarContainer = document.createElement("div");
    avatarContainer.classList.add(className);

    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = `Аватар ${username}`;
      avatarContainer.appendChild(img);
    } else {
      avatarContainer.dataset.initials = username.charAt(0).toUpperCase();
    }
    return avatarContainer;
  }

  // --- Real-time: Новое приглашение ---
  socket.on("new_invitation", (data) => {
    const invitationCard = document.createElement("div");
    invitationCard.classList.add("invitation-card");
    invitationCard.dataset.invitationId = data.invitation_id;

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("invitation-card__info");

    const avatarDiv = createAvatarElement(
      data.sender_username,
      data.sender_avatar_url,
      "invitation-card__avatar"
    );

    const usernameSpan = document.createElement("span");
    usernameSpan.classList.add("invitation-card__username");
    usernameSpan.textContent = data.sender_username;

    infoDiv.appendChild(avatarDiv);
    infoDiv.appendChild(usernameSpan);

    const actionsDiv = document.createElement("div");
    actionsDiv.classList.add("invitation-card__actions");

    const acceptButton = document.createElement("button");
    acceptButton.classList.add(
      "btn",
      "btn--primary",
      "invitation-card__accept-btn"
    );
    acceptButton.textContent = "Создать беседу";

    actionsDiv.appendChild(acceptButton);

    invitationCard.appendChild(infoDiv);
    invitationCard.appendChild(actionsDiv);

    pendingInvitationsDiv.appendChild(invitationCard);
    if (noInvitationsMessage) {
      noInvitationsMessage.style.display = "none";
    }
    attachInvitationAcceptListeners();
  });

  // --- Real-time: Приглашение принято (для отправителя) ---
  socket.on("invitation_accepted", (data) => {
    alert(
      `Ваше приглашение для ${data.receiver_username} было принято! Чат создан.`
    );
    window.location.reload();
  });

  // --- Real-time: Чат создан (для обоих пользователей) ---
  socket.on("chat_created", (data) => {
    const currentUserId = window.CURRENT_USER_ID;
    const otherUsername =
      data.user1_id === currentUserId
        ? data.user2_username
        : data.user1_username;
    const otherUserAvatarUrl =
      data.user1_id === currentUserId
        ? data.user2_avatar_url
        : data.user1_avatar_url;

    const chatCard = document.createElement("a");
    chatCard.href = `/chat/${data.chat_id}`;
    chatCard.classList.add("chat-card");
    chatCard.dataset.chatId = data.chat_id;

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("chat-card__info");

    const avatarDiv = createAvatarElement(
      otherUsername,
      otherUserAvatarUrl,
      "chat-card__avatar"
    );

    const usernameSpan = document.createElement("span");
    usernameSpan.classList.add("chat-card__username");
    usernameSpan.textContent = otherUsername;

    infoDiv.appendChild(avatarDiv);
    infoDiv.appendChild(usernameSpan);

    const actionDiv = document.createElement("div");
    actionDiv.classList.add("chat-card__action");

    const enterTextSpan = document.createElement("span");
    enterTextSpan.classList.add("chat-card__enter-text");
    enterTextSpan.textContent = "Войти в чат";

    actionDiv.appendChild(enterTextSpan);

    chatCard.appendChild(infoDiv);
    chatCard.appendChild(actionDiv);

    userChatsDiv.appendChild(chatCard);
    if (noChatsMessage) {
      noChatsMessage.style.display = "none";
    }
  });

  // --- Real-time: Чат удален (для обоих пользователей) ---
  socket.on("chat_deleted", (data) => {
    const chatId = data.chat_id;
    const deletedByUserId = data.deleted_by_user_id;
    const currentUserId = window.CURRENT_USER_ID;

    if (window.location.pathname === `/chat/${chatId}`) {
      alert(
        `Чат был удален пользователем ${
          deletedByUserId === currentUserId ? "вами" : "собеседником"
        }.`
      );
      window.location.href = "/home";
    } else {
      const chatCardToRemove = document.querySelector(
        `.chat-card[data-chat-id="${chatId}"]`
      );
      if (chatCardToRemove) {
        chatCardToRemove.remove();
        if (userChatsDiv.children.length === 0) {
          if (noChatsMessage) {
            noChatsMessage.style.display = "block";
          }
        }
      }
      alert(
        `Чат был удален пользователем ${
          deletedByUserId === currentUserId ? "вами" : "собеседником"
        }.`
      );
    }
  });

  // --- Отправка форм авторизации по Enter ---
  const loginFormInputs = document.querySelectorAll("#login-form input");
  const registerFormInputs = document.querySelectorAll("#register-form input");

  function attachEnterKeyListenerToFormInputs(inputs) {
    inputs.forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.target
            .closest("form")
            .querySelector('button[type="submit"]')
            ?.click();
        }
      });
    });
  }

  attachEnterKeyListenerToFormInputs(loginFormInputs);
  attachEnterKeyListenerToFormInputs(registerFormInputs);

  // --- Отправка поиска пользователей по Enter ---
  if (userSearchInput && userSearchButton) {
    userSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        userSearchButton.click();
      }
    });
  }

  if (userSearchButton) {
    userSearchButton.addEventListener("click", async () => {
      const query = userSearchInput.value;
      if (query.length < 2) {
        searchResultsDiv.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'home__empty-state';
        p.textContent = 'Введите минимум 2 символа для поиска.';
        searchResultsDiv.appendChild(p);
        return;
      }

      try {
        const response = await fetch(
          `/search_users?q=${encodeURIComponent(query)}`
        );
        const users = await response.json();

        searchResultsDiv.innerHTML = "";
        if (users.length === 0) {
          searchResultsDiv.innerHTML = '';
          const p = document.createElement('p');
          p.className = 'home__empty-state';
          p.textContent = 'Пользователи не найдены.';
          searchResultsDiv.appendChild(p);
          return;
        }

        users.forEach((user) => {
          const userCard = document.createElement("div");
          userCard.classList.add("user-card");

          const infoDiv = document.createElement("div");
          infoDiv.classList.add("user-card__info");

          const avatarDiv = createAvatarElement(
            user.username,
            user.avatar_url,
            "user-card__avatar"
          );

          const usernameSpan = document.createElement("span");
          usernameSpan.classList.add("user-card__username");
          usernameSpan.textContent = user.username;

          infoDiv.appendChild(avatarDiv);
          infoDiv.appendChild(usernameSpan);

          const actionsDiv = document.createElement("div");
          actionsDiv.classList.add("user-card__actions");

          if (user.has_chat) {
            const statusSpan = document.createElement("span");
            statusSpan.classList.add("user-card__status");
            statusSpan.textContent = "Чат уже существует";
            actionsDiv.appendChild(statusSpan);
          } else if (user.has_pending_invitation) {
            const statusSpan = document.createElement("span");
            statusSpan.classList.add("user-card__status");
            statusSpan.textContent = "Приглашение отправлено/получено";
            actionsDiv.appendChild(statusSpan);
          } else {
            const sendButton = document.createElement("button");
            sendButton.classList.add(
              "btn",
              "btn--primary",
              "btn--small",
              "send-invitation-btn"
            );
            sendButton.dataset.userId = user.id;
            sendButton.textContent = "Начать общение";
            actionsDiv.appendChild(sendButton);
          }

          userCard.appendChild(infoDiv);
          userCard.appendChild(actionsDiv);
          searchResultsDiv.appendChild(userCard);
        });

        document.querySelectorAll(".send-invitation-btn").forEach((button) => {
          button.addEventListener("click", async (event) => {
            const receiverId = event.target.dataset.userId;
            event.target.disabled = true;
            event.target.textContent = "Отправка...";

            try {
              const response = await secureFetch("/send_invitation", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ receiver_id: receiverId }),
              });
              const result = await response.json();

              if (result.success) {
                alert(result.message);
                event.target.textContent = "Приглашение отправлено";
                event.target.classList.remove("btn--primary");
                event.target.classList.add("btn--secondary");
              } else {
                alert(`Ошибка: ${result.message}`);
                event.target.disabled = false;
                event.target.textContent = "Начать общение";
              }
            } catch (error) {
              alert("Произошла ошибка при отправке приглашения.");
            }
          });
        });
      } catch (error) {
        searchResultsDiv.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'home__empty-state';
        p.textContent = 'Произошла ошибка при поиске.';
        searchResultsDiv.appendChild(p);
      }
    });
  }

  let currentModalConfirmCallback = null;

  const openKeyModal = (callback) => {
    keyModal.classList.add("modal--active");
    encryptionKeyInput.value = "";
    keyModalError.textContent = "";
    encryptionKeyInput.focus();
    currentModalConfirmCallback = callback;
  };

  if (confirmKeyButton) {
    confirmKeyButton.addEventListener("click", () => {
      if (currentModalConfirmCallback) {
        currentModalConfirmCallback();
      }
    });
  }

  function attachInvitationAcceptListeners() {
    document
      .querySelectorAll(".invitation-card__accept-btn")
      .forEach((button) => {
        button.onclick = async (event) => {
          const invitationCard = event.target.closest(".invitation-card");
          const invitationId = invitationCard.dataset.invitationId;
          event.target.disabled = true;
          event.target.textContent = "Принятие...";

          const handleKeyConfirmationForInvitation = async () => {
            const encryptionKey = encryptionKeyInput.value;
            if (encryptionKey.length < 8) {
              keyModalError.textContent =
                "Ключ должен быть не менее 8 символов.";
              return;
            }

            try {
              const response = await secureFetch(
                `/accept_invitation/${invitationId}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                }
              );
              const result = await response.json();

              if (result.success) {
                // Ключ хранится только в памяти, не в sessionStorage
                alert(result.message);
                keyModal.classList.remove("modal--active");
                invitationCard.remove();
                if (pendingInvitationsDiv.children.length === 0) {
                  if (noInvitationsMessage) {
                    noInvitationsMessage.style.display = "block";
                  }
                }
                window.location.href = `/chat/${result.chat_id}`;
              } else {
                keyModalError.textContent = `Ошибка: ${result.message}`;
                event.target.disabled = false;
                event.target.textContent = "Создать беседу";
              }
            } catch (error) {
              keyModalError.textContent =
                "Произошла ошибка при принятии приглашения.";
              event.target.disabled = false;
              event.target.textContent = "Создать беседу";
            }
          };

          openKeyModal(handleKeyConfirmationForInvitation);
        };
      });
  }

  if (pendingInvitationsDiv) {
    attachInvitationAcceptListeners();
  }

  // --- Функции шифрования/дешифрования (Web Crypto API) ---
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    // Если соль не передана — генерируем случайную (16 байт)
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(16));
    }
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const keyBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 600000,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );
    const key = await crypto.subtle.importKey("raw", keyBits, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt",
    ]);
    return { key, salt };
  }

  // --- Отпечаток ключа (Key Fingerprint) ---
  const FINGERPRINT_EMOJIS = [
    '🐻','🐯','🦁','🐺','🦊','🐵','🐘','🦒','🦓','🦍','🐨','🐼','🦥','🦔','🐢','🐍',
    '🐲','🐉','🦕','🦖','🐳','🐬','🧭','🐟','🐠','🐡','🦈','🐙','🦑','🪸','🐌','🦋',
    '🐛','🐜','🐝','🪲','🐞','🦗','🦫','🪳','🕷️','🪰','🪱','💐','🌸','🌷','🌻','🌺',
    '🌹','🌼','🌾','🌲','🌳','🌴','🌵','🌿','☘️','🍁','🍂','🍃','🍄','🪶','🪴','🪵',
    '🍇','🍈','🍉','🍊','🍋','🍌','🍍','🍎','🍏','🍐','🍑','🍒','🍓','🫐','🍅','🥥',
    '🌶️','🥒','🥕','🌽','🥝','🥜','🥐','🍞','🥖','🧀','🍖','🍗','🥩','🍔','🍕','🌭',
    '🥪','🌮','🌯','🫔','🍳','🥘','🍲','🫕','🥣','🥗','🧭','🍿','🧈','🧂','🧁','🎂',
    '🍰','🧇','🍩','🍪','🍫','🍬','🍭','🍮','🍯','☕','🍵','🍶','🍺','🍻','🥂','🍷',
    '🚀','✈️','🛩️','🚁','🚂','🚃','🚄','🚅','🚈','🚌','🚎','🚐','🚑','🚒','🚓','🚕',
    '🚗','🚙','🚲','🛵','🚢','⛵','🚤','🛶','🛥️','🗼','🏰','🏔️','🏕️','🏝️','🏠','🏢',
    '⚽','🏀','🏈','⚾','🎾','🏐','🎱','🎳','🎯','⛳','🎿','⛸️','🤺','🏇','🏄','🏊',
    '🎨','🎬','🎵','🎸','🎹','🎺','🎻','🥁','🎭','🎮','🎲','🧩','🔑','🔐','🔒','🔓',
    '💡','🔆','🔮','🧪','🧲','🧳','🧻','🧹','🧺','🧴','🧵','🧶','🧷','🧸','🧷','💎',
    '🌍','🌎','🌏','🌋','🌙','🌚','🌛','🌜','🌝','🌞','⭐','🌟','🌠','⚡','🌈','☄️',
    '❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','♥️','💕','💝','💖','💗','💓','💞'
  ];

  async function generateKeyFingerprint(password) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashBytes = new Uint8Array(hashBuffer);
    let emojis = '';
    for (let i = 0; i < 8; i++) {
      emojis += FINGERPRINT_EMOJIS[hashBytes[i] % FINGERPRINT_EMOJIS.length];
    }
    return emojis;
  }

  function showFingerprint(emojis) {
    const display = document.getElementById('key-fingerprint-display');
    const emojisSpan = document.getElementById('key-fingerprint-emojis');
    if (display && emojisSpan) {
      emojisSpan.textContent = emojis;
      display.classList.add('key-fingerprint--active');
    }
  }

  function hideFingerprint() {
    const display = document.getElementById('key-fingerprint-display');
    if (display) display.classList.remove('key-fingerprint--active');
  }

  // Обновленная функция encryptMessage для работы с текстом и ArrayBuffer
  async function encryptMessage(data, keyObj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    let dataToEncrypt;

    if (typeof data === "string") {
      dataToEncrypt = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      dataToEncrypt = new Uint8Array(data);
    } else {
      throw new Error(
        "Unsupported data type for encryption. Must be string or ArrayBuffer."
      );
    }

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      keyObj.key,
      dataToEncrypt
    );
    const saltBase64 = btoa(String.fromCharCode(...keyObj.salt));
    const ivBase64 = btoa(String.fromCharCode(...iv));
    const encryptedBase64 = btoa(
      String.fromCharCode(...new Uint8Array(encrypted))
    );
    // Формат: salt:iv:ciphertext
    return `${saltBase64}:${ivBase64}:${encryptedBase64}`;
  }

  // --- Паддинг сообщений (маскировка длины) ---
  const TEXT_PAD_SIZE = 4096; // Все текстовые сообщения дополняются до 4 КБ

  function padMessage(text) {
    // Формат: timestamp|realLength|text|randomPadding
    const timestamp = new Date().toISOString();
    const payload = `${timestamp}|${text}`;
    const payloadBytes = new TextEncoder().encode(payload);
    const lengthPrefix = `${payloadBytes.length}:`;
    const prefixBytes = new TextEncoder().encode(lengthPrefix);
    const totalHeaderSize = prefixBytes.length + payloadBytes.length;
    const padSize = Math.max(0, TEXT_PAD_SIZE - totalHeaderSize);
    // Случайный паддинг
    const paddingArray = new Uint8Array(padSize);
    crypto.getRandomValues(paddingArray);
    const paddingStr = Array.from(paddingArray).map(b => String.fromCharCode(32 + (b % 95))).join('');
    return `${lengthPrefix}${payload}${paddingStr}`;
  }

  function unpadMessage(padded) {
    // Извлекаем realLength, затем payload, затем timestamp и текст
    const colonIndex = padded.indexOf(':');
    if (colonIndex === -1) return { text: padded, timestamp: null };
    const realLength = parseInt(padded.substring(0, colonIndex), 10);
    if (isNaN(realLength)) return { text: padded, timestamp: null };
    const payload = padded.substring(colonIndex + 1, colonIndex + 1 + realLength);
    // payload = "timestamp|text"
    const pipeIndex = payload.indexOf('|');
    if (pipeIndex === -1) return { text: payload, timestamp: null };
    const timestamp = payload.substring(0, pipeIndex);
    const text = payload.substring(pipeIndex + 1);
    return { text, timestamp };
  }

  // Обновленная функция decryptMessage для работы с текстом и ArrayBuffer
  // Поддерживает как новый формат (salt:iv:ciphertext), так и старый (iv:ciphertext)
  async function decryptMessage(encryptedTextWithIv, keyObj, messageType) {
    try {
      const parts = encryptedTextWithIv.split(":");
      let iv, encrypted, decryptKey;

      if (parts.length === 3) {
        // Новый формат: salt:iv:ciphertext
        const salt = new Uint8Array(
          atob(parts[0]).split("").map((char) => char.charCodeAt(0))
        );
        iv = new Uint8Array(
          atob(parts[1]).split("").map((char) => char.charCodeAt(0))
        );
        encrypted = new Uint8Array(
          atob(parts[2]).split("").map((char) => char.charCodeAt(0))
        );
        // Derive key with the salt from the message
        const derived = await deriveKey(currentRawPassword, salt);
        decryptKey = derived.key;
      } else if (parts.length === 2) {
        // Старый формат (обратная совместимость): iv:ciphertext
        iv = new Uint8Array(
          atob(parts[0]).split("").map((char) => char.charCodeAt(0))
        );
        encrypted = new Uint8Array(
          atob(parts[1]).split("").map((char) => char.charCodeAt(0))
        );
        decryptKey = keyObj.key;
      } else {
        throw new Error("Invalid encrypted message format.");
      }

      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        decryptKey,
        encrypted
      );

      if (messageType === "text") {
        return new TextDecoder().decode(decrypted);
      } else if (messageType === "audio") {
        return decrypted;
      }
      return "[Неизвестный тип сообщения]";
    } catch (e) {
      return "[Не удалось расшифровать сообщение. Неверный ключ?]";
    }
  }

  // --- Логика для chat.html ---
  // Читаем конфиг из data-атрибутов (вместо inline JS)
  const chatConfigEl = document.getElementById("chat-config");
  const chatMessagesDiv = document.getElementById("chat-messages");
  const messageInput = document.getElementById("message-input");
  const sendMessageButton = document.getElementById("send-message-button");
  const changeKeyButton = document.getElementById("change-key-button");
  const deleteChatButton = document.getElementById("delete-chat-button");
  const typingIndicator = document.getElementById("typing-indicator");

  // Элементы для голосовых сообщений
  const recordAudioButton = document.getElementById("record-audio-button");
  const stopRecordingButton = document.getElementById("stop-recording-button");
  const recordingTimer = document.getElementById("recording-timer");

  let currentEncryptionKey = null;  // Объект { key, salt }
  let currentRawPassword = null;    // Сырой пароль для re-derive при дешифровке
  let lastMessageId = 0;
  let pollingInterval = null;
  let typingTimeout = null;
  let isTyping = false;

  // Читаем конфиг чата из data-атрибутов (if on chat page)
  const CHAT_ID = chatConfigEl ? Number(chatConfigEl.dataset.chatId) : (window.CHAT_ID || null);
  const CURRENT_USER_ID = chatConfigEl ? Number(chatConfigEl.dataset.currentUserId) : (window.CURRENT_USER_ID || null);
  const OTHER_USER_ID = chatConfigEl ? Number(chatConfigEl.dataset.otherUserId) : (window.OTHER_USER_ID || null);
  const CURRENT_USER_AVATAR_URL = chatConfigEl ? chatConfigEl.dataset.currentUserAvatar : (window.CURRENT_USER_AVATAR_URL || null);
  const OTHER_USER_AVATAR_URL = chatConfigEl ? chatConfigEl.dataset.otherUserAvatar : (window.OTHER_USER_AVATAR_URL || null);

  // Переменные для записи аудио
  let mediaRecorder;
  let audioChunks = [];
  let audioStream;
  let isRecording = false;
  let recordingStartTime;
  let recordingTimerInterval;

  // --- Исчезающие сообщения ---
  let ephemeralMode = false;
  const EPHEMERAL_TIMEOUT = 30000; // 30 секунд
  const ephemeralTimers = new Map(); // messageId -> timeoutId

  function scheduleEphemeralDestroy(messageId, messageBubble) {
    if (ephemeralTimers.has(messageId)) return; // уже запланировано
    const timerId = setTimeout(async () => {
      // Заменяем текст в DOM
      const contentDiv = messageBubble.querySelector('.message-bubble__content');
      if (contentDiv) {
        const decryptedSpan = contentDiv.querySelector('.decrypted-text');
        if (decryptedSpan) decryptedSpan.textContent = '[Сообщение удалено]';
        // Для аудио тоже
        const audioPlayer = contentDiv.querySelector('.audio-player');
        if (audioPlayer) {
        const timeText = document.createElement('span');
        timeText.className = 'audio-player__time';
        timeText.textContent = '[Удалено]';
        audioPlayer.innerHTML = '';
        audioPlayer.appendChild(timeText);
        }
      }
      messageBubble.classList.add('message-bubble--expired');
      // Удаляем из БД
      try {
        await secureFetch(`/delete_message/${messageId}`, {
          method: 'POST',
          headers: { 'X-CSRFToken': getCSRFToken() }
        });
      } catch (e) { /* игнорируем */ }
      ephemeralTimers.delete(messageId);
    }, EPHEMERAL_TIMEOUT);
    ephemeralTimers.set(messageId, timerId);
  }

  // --- Авто-блокировка при бездействии ---
  const INACTIVITY_TIMEOUT = 180000; // 3 минуты
  let inactivityTimer = null;
  const sessionLockOverlay = document.getElementById('session-lock-overlay');
  const sessionUnlockBtn = document.getElementById('session-unlock-btn');

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (!chatMessagesDiv || !CHAT_ID) return; // только на странице чата
    if (!currentEncryptionKey) return; // нет смысла блокировать если ключа нет
    inactivityTimer = setTimeout(lockSession, INACTIVITY_TIMEOUT);
  }

  function lockSession() {
    // Обнуляем ключи
    currentEncryptionKey = null;
    currentRawPassword = null;
    // Скрываем все расшифрованные тексты
    if (chatMessagesDiv) {
      chatMessagesDiv.querySelectorAll('.decrypted-text').forEach(el => {
        el.textContent = '[Сессия истекла]';
      });
      chatMessagesDiv.querySelectorAll('.audio-player').forEach(el => {
        const audio = el.querySelector('audio');
        if (audio) { audio.pause(); audio.src = ''; }
        el.querySelector('.audio-player__time').textContent = '[Сессия истекла]';
      });
    }
    // Скрываем fingerprint
    hideFingerprint();
    // Останавливаем поллинг
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    // Показываем оверлей
    if (sessionLockOverlay) sessionLockOverlay.classList.add('session-lock-overlay--active');
  }

  function unlockSession() {
    if (sessionLockOverlay) sessionLockOverlay.classList.remove('session-lock-overlay--active');
    openKeyModal(handleKeyConfirmationForChatPage);
  }

  // Подписка на события активности пользователя
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(eventType => {
    document.addEventListener(eventType, resetInactivityTimer, { passive: true });
  });

  if (sessionUnlockBtn) {
    sessionUnlockBtn.addEventListener('click', unlockSession);
  }

  function startPollingMessages() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchNewMessages, 3000);
  }

  if (encryptionKeyInput) {
    encryptionKeyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmKeyButton?.click();
      }
    });
  }

  function scrollToBottom() {
    if (chatMessagesDiv) {
      chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }
  }

  async function decryptAndRenderMessages(messagesToRender) {
    for (const msgElement of messagesToRender) {
      const messageBubbleContentDiv = msgElement.querySelector(
        ".message-bubble__content"
      );
      const encryptedContent = messageBubbleContentDiv.dataset.encryptedContent;
      const messageType = messageBubbleContentDiv.dataset.messageType || "text";

      if (encryptedContent && currentEncryptionKey) {
        const decryptedContent = await decryptMessage(
          encryptedContent,
          currentEncryptionKey,
          messageType
        );
        if (messageType === "text") {
          // Извлекаем текст и timestamp из padded-сообщения
          const unpacked = unpadMessage(decryptedContent);
          messageBubbleContentDiv.querySelector(".decrypted-text").textContent =
            unpacked.text;
          // Обновляем время из зашифрованного payload (точное время клиента)
          if (unpacked.timestamp) {
            const timeDiv = msgElement.querySelector(".message-bubble__time");
            if (timeDiv) {
              timeDiv.textContent = new Date(unpacked.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
            }
          }
        } else if (messageType === "audio") {
          renderAudioMessage(decryptedContent, messageBubbleContentDiv);
        }
      } else if (encryptedContent && !currentEncryptionKey) {
        if (messageType === "text") {
          messageBubbleContentDiv.querySelector(".decrypted-text").textContent =
            "[Введите ключ для дешифрования]";
        } else if (messageType === "audio") {
          const audioPlayer =
            messageBubbleContentDiv.querySelector(".audio-player");
          if (audioPlayer) {
            audioPlayer.querySelector(".audio-player__time").textContent =
              "[Не расшифровано]";
            audioPlayer.querySelector(
              ".audio-player__play-btn"
            ).disabled = true;
            // audioPlayer.querySelector(".audio-player__seek-slider").disabled = true // Удалено
          }
        }
      }
      // Исчезающие сообщения для начально загруженных сообщений
      if (ephemeralMode && currentEncryptionKey) {
        const msgBubble = msgElement.querySelector('.message-bubble');
        const msgId = msgBubble ? msgBubble.dataset.messageId : null;
        if (msgId && msgBubble) {
          scheduleEphemeralDestroy(Number(msgId), msgBubble);
        }
      }
    }
  }

  // Функция для рендеринга аудиосообщения
  function renderAudioMessage(audioBuffer, parentDiv) {
    const audioPlayerDiv = parentDiv.querySelector(".audio-player");
    if (!audioPlayerDiv) {
      // console.error("Audio player div not found in message content.") // Удалено
      return;
    }

    const playButton = audioPlayerDiv.querySelector(".audio-player__play-btn");
    const timeSpan = audioPlayerDiv.querySelector(".audio-player__time");
    const audio = audioPlayerDiv.querySelector(".audio-player__audio");
    // const seekSlider = audioPlayerDiv.querySelector(".audio-player__seek-slider") // Удалено

    // console.log("renderAudioMessage: audioBuffer received", audioBuffer) // Удалено
    if (audioBuffer instanceof ArrayBuffer) {
      // console.log("renderAudioMessage: audioBuffer is ArrayBuffer, byteLength:", audioBuffer.byteLength) // Удалено
    } else {
      // console.error("renderAudioMessage: audioBuffer is NOT an ArrayBuffer!", typeof audioBuffer) // Удалено
      timeSpan.textContent = "Ошибка данных";
      playButton.disabled = true;
      // seekSlider.disabled = true // Удалено
      return;
    }

    // Создаем Blob с правильным MIME-типом
    const audioBlob = new Blob([audioBuffer], { type: window.AUDIO_MIME_TYPE });
    // console.log("renderAudioMessage: Created audioBlob", audioBlob) // Удалено
    audio.src = URL.createObjectURL(audioBlob);
    // console.log("renderAudioMessage: Audio src set to", audio.src) // Удалено

    // НОВОЕ: Загружаем аудио, чтобы убедиться, что метаданные доступны
    audio.load();

    // Обработчик загрузки метаданных
    audio.onloadedmetadata = () => {
      // console.log("Audio onloadedmetadata fired. Duration:", audio.duration) // Удалено
      // console.log("Audio readyState:", audio.readyState, "networkState:", audio.networkState) // Удалено
      if (audio.error) {
        // console.error("Audio error on loadedmetadata:", audio.error.code, audio.error.message) // Удалено
      }

      if (
        isNaN(audio.duration) ||
        !isFinite(audio.duration) ||
        audio.duration === 0
      ) {
        // console.warn("Audio duration is NaN, Infinity, or 0. Audio file might be corrupted or unsupported.") // Удалено
        timeSpan.textContent = "0:00"; // Отображаем 0:00
        // seekSlider.max = 0 // Удалено
        // seekSlider.value = 0 // У��алено
        // seekSlider.disabled = true // Удалено
        playButton.disabled = false; // Но кнопку воспроизведения оставляем активной
        return;
      }
      const duration = Math.floor(audio.duration);
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      timeSpan.textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
      // seekSlider.max = duration // Удалено
      // seekSlider.value = 0 // Удалено
      playButton.disabled = false; // Включаем кнопку воспроизведения
      // seekSlider.disabled = false // Удалено
    };

    // Обработчик ошибок воспроизведения
    audio.onerror = (e) => {
      // console.error("Audio playback error:", e) // Удалено
      if (audio.error) {
        // console.error("MediaError code:", audio.error.code, "message:", audio.error.message) // Удалено
        switch (audio.error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            timeSpan.textContent = "Воспроизведение прервано";
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            timeSpan.textContent = "Ошибка сети";
            break;
          case MediaError.MEDIA_ERR_DECODE:
            timeSpan.textContent = "Ошибка декодирования";
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            timeSpan.textContent = "Формат не поддерживается";
            break;
          default:
            timeSpan.textContent = "Ошибка воспроизведения";
            break;
        }
      } else {
        timeSpan.textContent = "Ошибка воспроизведения";
      }
      playButton.disabled = true;
      // seekSlider.disabled = true // Удалено
    };

    // Обработчик кнопки воспроизведения/паузы
    playButton.onclick = () => {
      if (audio.paused) {
        audio.play().catch((err) => { /* audio playback error */ });
        playButton.textContent = "⏸️";
      } else {
        audio.pause();
        playButton.textContent = "▶️";
      }
    };

    // Обновление ползунка и времени при воспроизведении
    audio.ontimeupdate = () => {
      const currentTime = Math.floor(audio.currentTime);
      const duration = Math.floor(audio.duration);
      const minutes = Math.floor(currentTime / 60);
      const seconds = currentTime % 60;
      timeSpan.textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
      // seekSlider.value = currentTime // Удалено
    };

    // Сброс кнопки и ползунка по окончании воспроизведения
    audio.onended = () => {
      playButton.textContent = "▶️";
      audio.currentTime = 0; // Сброс на начало
      // seekSlider.value = 0 // Удалено
    };

    // Перемотка при изменении ползунка
    // seekSlider.oninput = () => { // Удалено
    //   audio.currentTime = seekSlider.value // Удалено
    // } // Удалено
  }

  const handleKeyConfirmationForChatPage = async () => {
    const encryptionKey = encryptionKeyInput.value;
    if (encryptionKey.length < 8) {
      keyModalError.textContent = "Ключ должен быть не менее 8 символов.";
      return;
    }
    try {
      currentRawPassword = encryptionKey;
      currentEncryptionKey = await deriveKey(encryptionKey);
      keyModal.classList.remove("modal--active");

      // Показываем отпечаток ключа
      const fingerprint = await generateKeyFingerprint(encryptionKey);
      showFingerprint(fingerprint);

      const allMessages = chatMessagesDiv.querySelectorAll(".message-wrapper");
      await decryptAndRenderMessages(allMessages);
      scrollToBottom();
      startPollingMessages();

      // Запускаем таймер неактивности
      resetInactivityTimer();
    } catch (error) {
      currentRawPassword = null;
      keyModalError.textContent =
        "Ошибка при обработке ключа. Попробуйте другой ключ или перезагрузите страницу.";
    }
  };

  if (changeKeyButton) {
    changeKeyButton.addEventListener("click", () => {
      openKeyModal(handleKeyConfirmationForChatPage);
    });
  }

  const fetchNewMessages = async () => {
    try {
      const response = await fetch(
        `/get_messages/${CHAT_ID}?last_id=${lastMessageId}`
      );
      const newMessages = await response.json();

      if (newMessages.length > 0) {
        for (const msg of newMessages) {
          const messageWrapper = document.createElement("div");
          messageWrapper.classList.add("message-wrapper");
          messageWrapper.classList.add(
            msg.sender_id === CURRENT_USER_ID
              ? "message-wrapper--sent"
              : "message-wrapper--received"
          );

          // Аватар
          const avatarContainer = createAvatarElement(
            msg.sender_username,
            msg.sender_avatar_url,
            "message-bubble__avatar-container"
          );
          messageWrapper.appendChild(avatarContainer);

          const messageBubble = document.createElement("div");
          messageBubble.classList.add("message-bubble");
          messageBubble.classList.add(
            msg.sender_id === CURRENT_USER_ID
              ? "message-bubble--sent"
              : "message-bubble--received"
          );
          messageBubble.dataset.messageId = msg.id;

          const senderDiv = document.createElement("div");
          senderDiv.classList.add("message-bubble__sender");
          senderDiv.textContent = msg.sender_username;

          const contentDiv = document.createElement("div");
          contentDiv.classList.add("message-bubble__content");
          contentDiv.dataset.encryptedContent = msg.content;
          contentDiv.dataset.messageType = msg.message_type;

          if (msg.message_type === "text") {
            const decryptedSpan = document.createElement("span");
            decryptedSpan.classList.add("decrypted-text");
            if (currentEncryptionKey) {
              const rawDecrypted = await decryptMessage(
                  msg.content,
                  currentEncryptionKey,
                  msg.message_type
              );
              const unpacked = unpadMessage(rawDecrypted);
              decryptedSpan.textContent = unpacked.text;
              // Используем точное время из payload вместо серверного
              if (unpacked.timestamp) {
                msg._clientTimestamp = unpacked.timestamp;
              }
            } else {
              decryptedSpan.textContent = "[Введите ключ для дешифрования]";
            }
            contentDiv.appendChild(decryptedSpan);
          } else if (msg.message_type === "audio") {
            // Для аудио создаем плеер
            const audioPlayerDiv = document.createElement("div");
            audioPlayerDiv.classList.add("audio-player");
            audioPlayerDiv.innerHTML = `
              <button class="audio-player__play-btn" disabled>▶️</button>
              <span class="audio-player__time">Загрузка...</span>
              <audio class="audio-player__audio" preload="none"></audio>
            `;
            contentDiv.appendChild(audioPlayerDiv);
            if (currentEncryptionKey) {
              const decryptedAudioBuffer = await decryptMessage(
                msg.content,
                currentEncryptionKey,
                msg.message_type
              );
              // console.log(`fetchNewMessages: Decrypted audio buffer for new message:`, decryptedAudioBuffer) // Удалено
              renderAudioMessage(decryptedAudioBuffer, contentDiv);
            } else {
              audioPlayerDiv.querySelector(".audio-player__time").textContent =
                "[Не расшифровано]";
            }
          }

          const timeDiv = document.createElement("div");
          timeDiv.classList.add("message-bubble__time");
          // Используем точное время из зашифрованного payload, или клиентское время
          const displayTime = msg._clientTimestamp
            ? new Date(msg._clientTimestamp)
            : new Date();
          timeDiv.textContent = displayTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          messageBubble.appendChild(senderDiv);
          messageBubble.appendChild(contentDiv);
          messageBubble.appendChild(timeDiv);
          messageWrapper.appendChild(messageBubble);

          chatMessagesDiv.appendChild(messageWrapper);
          lastMessageId = Math.max(lastMessageId, msg.id);

          // Исчезающие сообщения: ставим таймер
          if (ephemeralMode && currentEncryptionKey) {
            scheduleEphemeralDestroy(msg.id, messageBubble);
          }
        }
        scrollToBottom();
      }
    } catch (error) {
      // console.error("Error fetching new messages:", error) // Удалено
    }
  };

  if (chatMessagesDiv && CHAT_ID && CURRENT_USER_ID) {
    // Обработка кликов по меню чата (перенесено из inline JS)
    const chatMenuToggle = document.querySelector('.chat-menu__toggle');
    const chatMenuDropdown = document.querySelector('.chat-menu__dropdown');
    if (chatMenuToggle && chatMenuDropdown) {
      chatMenuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        chatMenuDropdown.style.display = chatMenuDropdown.style.display === 'block' ? 'none' : 'block';
      });
      document.addEventListener('click', function() {
        chatMenuDropdown.style.display = 'none';
      });
      chatMenuDropdown.addEventListener('click', function(e) {
        e.stopPropagation();
      });
    }

    // Переключатель исчезающих сообщений
    const toggleEphemeralBtn = document.getElementById('toggle-ephemeral');
    const ephemeralStatusSpan = document.getElementById('ephemeral-status');
    if (toggleEphemeralBtn) {
      toggleEphemeralBtn.addEventListener('click', function() {
        ephemeralMode = !ephemeralMode;
        if (ephemeralStatusSpan) {
          ephemeralStatusSpan.textContent = ephemeralMode ? 'Вкл' : 'Выкл';
          ephemeralStatusSpan.classList.toggle('ephemeral-toggle__status--on', ephemeralMode);
        }
      });
    }

    // Ключ хранится только в памяти — всегда запрашиваем при входе в чат
    openKeyModal(handleKeyConfirmationForChatPage);

    if (sendMessageButton) {
      sendMessageButton.addEventListener("click", async () => {
        const messageText = messageInput.value.trim();
        if (!messageText || !currentEncryptionKey) {
          alert("Введите сообщение и убедитесь, что ключ введен.");
          return;
        }
        try {
          // Паддинг текста + встроенный timestamp
          const paddedText = padMessage(messageText);
          const encryptedContent = await encryptMessage(
            paddedText,
            currentEncryptionKey
          );
          const response = await secureFetch("/send_message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: CHAT_ID,
              content: encryptedContent,
              message_type: "text",
              is_ephemeral: ephemeralMode,
            }),
          });
          const result = await response.json();
          if (result.success) {
            messageInput.value = "";
            if (isTyping) {
              socket.emit("stop_typing", {
                chat_id: CHAT_ID,
                sender_id: CURRENT_USER_ID,
              });
              isTyping = false;
            }
          } else {
            alert(`Ошибка отправки: ${result.message}`);
          }
        } catch (error) {
          alert("Произошла ошибка при отправке сообщения.");
        }
      });
    }

    if (messageInput) {
      messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          sendMessageButton.click();
        }
      });
    }

    socket.on("new_message", async (msg) => {
      if (msg.chat_id === CHAT_ID) {
        const messageWrapper = document.createElement("div");
        messageWrapper.classList.add("message-wrapper");
        messageWrapper.classList.add(
          msg.sender_id === CURRENT_USER_ID
            ? "message-wrapper--sent"
            : "message-wrapper--received"
        );

        // Аватар
        const avatarContainer = createAvatarElement(
          msg.sender_username,
          msg.sender_avatar_url,
          "message-bubble__avatar-container"
        );
        messageWrapper.appendChild(avatarContainer);

        const messageBubble = document.createElement("div");
        messageBubble.classList.add("message-bubble");
        messageBubble.classList.add(
          msg.sender_id === CURRENT_USER_ID
            ? "message-bubble--sent"
            : "message-bubble--received"
        );
        messageBubble.dataset.messageId = msg.id;

        const senderDiv = document.createElement("div");
        senderDiv.classList.add("message-bubble__sender");
        senderDiv.textContent = msg.sender_username;

        const contentDiv = document.createElement("div");
        contentDiv.classList.add("message-bubble__content");
        contentDiv.dataset.encryptedContent = msg.content;
        contentDiv.dataset.messageType = msg.message_type;

        if (msg.message_type === "text") {
          const decryptedSpan = document.createElement("span");
          decryptedSpan.classList.add("decrypted-text");
          if (currentEncryptionKey) {
            const rawDecrypted = await decryptMessage(
                msg.content,
                currentEncryptionKey,
                msg.message_type
            );
            const unpacked = unpadMessage(rawDecrypted);
            decryptedSpan.textContent = unpacked.text;
            if (unpacked.timestamp) {
              msg._clientTimestamp = unpacked.timestamp;
            }
          } else {
            decryptedSpan.textContent = "[Введите ключ для дешифрования]";
          }
          contentDiv.appendChild(decryptedSpan);
        } else if (msg.message_type === "audio") {
          const audioPlayerDiv = document.createElement("div");
          audioPlayerDiv.classList.add("audio-player");
          audioPlayerDiv.innerHTML = `
          <button class="audio-player__play-btn" disabled>▶️</button>
          <span class="audio-player__time">Загрузка...</span>
          <audio class="audio-player__audio" preload="none"></audio>
        `;
          contentDiv.appendChild(audioPlayerDiv);
          if (currentEncryptionKey) {
            const decryptedAudioBuffer = await decryptMessage(
              msg.content,
              currentEncryptionKey,
              msg.message_type
            );
            // console.log(`new_message: Decrypted audio buffer for new message:`, decryptedAudioBuffer) // Удалено
            renderAudioMessage(decryptedAudioBuffer, contentDiv);
          } else {
            audioPlayerDiv.querySelector(".audio-player__time").textContent =
              "[Не расшифровано]";
          }
        }

        const timeDiv = document.createElement("div");
        timeDiv.classList.add("message-bubble__time");
        const displayTime = msg._clientTimestamp
          ? new Date(msg._clientTimestamp)
          : new Date();
        timeDiv.textContent = displayTime.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

        messageBubble.appendChild(senderDiv);
        messageBubble.appendChild(contentDiv);
        messageBubble.appendChild(timeDiv);
        messageWrapper.appendChild(messageBubble);

        chatMessagesDiv.appendChild(messageWrapper);
        lastMessageId = Math.max(lastMessageId, msg.id);
        scrollToBottom();
        if (typingIndicator) {
          typingIndicator.style.display = "none";
        }

        // Исчезающие сообщения: ставим таймер
        if (ephemeralMode && currentEncryptionKey) {
          scheduleEphemeralDestroy(msg.id, messageBubble);
        }
      }
    });

    const existingMessageElements =
      chatMessagesDiv.querySelectorAll(".message-bubble");
    if (existingMessageElements.length > 0) {
      lastMessageId = Number.parseInt(
        existingMessageElements[existingMessageElements.length - 1].dataset
          .messageId || 0
      );
    }

    socket.emit("join_chat_room", { chat_id: CHAT_ID });

    if (deleteChatButton) {
      deleteChatButton.addEventListener("click", async () => {
        if (
          confirm(
            "Вы уверены, что хотите удалить этот чат? Это действие необратимо и удалит чат у обоих пользователей."
          )
        ) {
          try {
            const response = await secureFetch(`/delete_chat/${CHAT_ID}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            });
            const result = await response.json();

            if (result.success) {
              alert(result.message);
            } else {
              alert(`Ошибка удаления чата: ${result.message}`);
            }
          } catch (error) {
            alert("Произошла ошибка при удалении чата.");
          }
        }
      });
    }

    // --- Логика индикатора печатания ---
    if (messageInput && typingIndicator) {
      messageInput.addEventListener("input", () => {
        if (!isTyping) {
          socket.emit("typing", {
            chat_id: CHAT_ID,
            sender_id: CURRENT_USER_ID,
          });
          isTyping = true;
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          socket.emit("stop_typing", {
            chat_id: CHAT_ID,
            sender_id: CURRENT_USER_ID,
          });
          isTyping = false;
        }, 1500);
      });

      socket.on("typing", (data) => {
        if (data.chat_id === CHAT_ID && data.sender_id === OTHER_USER_ID) {
          typingIndicator.style.display = "flex";
          scrollToBottom();
        }
      });

      socket.on("stop_typing", (data) => {
        if (data.chat_id === CHAT_ID && data.sender_id === OTHER_USER_ID) {
          typingIndicator.style.display = "none";
        }
      });
    }

    // --- Логика записи голосовых сообщений ---
    if (recordAudioButton && stopRecordingButton && recordingTimer) {
      // ИЗМЕНЕНО: Возвращаем MIME-тип на WebM Opus
      const RECORD_MIME_TYPE = "audio/webm; codecs=opus";
      window.AUDIO_MIME_TYPE = RECORD_MIME_TYPE; // Сохраняем для использования в renderAudioMessage

      recordAudioButton.addEventListener("click", async () => {
        if (!currentEncryptionKey) {
          alert(
            "Пожалуйста, введите ключ шифрования, прежде чем записывать голосовое сообщение."
          );
          return;
        }

        // console.log(`MIME type ${RECORD_MIME_TYPE} IS supported.`) // Удалено

        try {
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: RECORD_MIME_TYPE,
            audioBitsPerSecond: 48000, // Указываем битрейт (например, 48kbps)
          });
          audioChunks = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunks.push(event.data);
            }
          };

          mediaRecorder.onstop = async () => {
            // console.log("MediaRecorder onstop event fired.") // Удалено
            const audioBlob = new Blob(audioChunks, { type: RECORD_MIME_TYPE });
            // console.log("Recording stopped. Final audioBlob size:", audioBlob.size, "type:", audioBlob.type) // Удалено

            // Удалена отладочная ссылка для скачивания

            if (audioBlob.size === 0) {
              // console.error("Recorded audio blob is empty. Recording might have failed.") // Удалено
              alert(
                "Не удалось записать аудио. Возможно, микрофон не работал или запись была слишком короткой."
              );
              // Сбрасываем UI
              recordAudioButton.style.display = "inline-flex";
              stopRecordingButton.style.display = "none";
              messageInput.style.display = "block";
              sendMessageButton.style.display = "inline-flex";
              recordingTimer.style.display = "none";
              clearInterval(recordingTimerInterval);
              recordingTimer.textContent = "0:00";
              audioStream.getTracks().forEach((track) => track.stop());
              return;
            }

            // НОВОЕ: Проверка длительности аудио перед отправкой
            const tempAudio = document.createElement("audio");
            tempAudio.preload = "metadata"; // Загружаем только метаданные
            tempAudio.src = URL.createObjectURL(audioBlob);

            // НОВОЕ: Добавляем обработчик для onloadedmetadata
            tempAudio.onloadedmetadata = async () => {
              URL.revokeObjectURL(tempAudio.src); // Очищаем временный URL
              // console.log("Temporary audio loaded metadata. Duration:", tempAudio.duration) // Удалено
              // console.log("Temporary audio readyState:", tempAudio.readyState, "networkState:", tempAudio.networkState) // Удалено
              if (tempAudio.error) {
                // console.error("Temporary audio error on loadedmetadata:", tempAudio.error.code, tempAudio.error.message) // Удалено
              }

              // ИЗМЕНЕНО: Логика проверки длительности
              if (isNaN(tempAudio.duration) || tempAudio.duration === 0) {
                // console.error("Recorded audio has invalid duration metadata (NaN or 0). Not sending.") // Удалено
                alert(
                  "Записанное аудио имеет некорректную длительность (0 секунд). Пожалуйста, попробуйте записать дольше (минимум 2-3 секунды)."
                );
                // Сбрасываем UI
                recordAudioButton.style.display = "inline-flex";
                stopRecordingButton.style.display = "none";
                messageInput.style.display = "block";
                sendMessageButton.style.display = "inline-flex";
                recordingTimer.style.display = "none";
                clearInterval(recordingTimerInterval);
                recordingTimer.textContent = "0:00";
                audioStream.getTracks().forEach((track) => track.stop());
                return;
              } else if (!isFinite(tempAudio.duration)) {
                // Если длительность Infinity, логируем предупреждение, но продолжаем
                // console.warn("Recorded audio has Infinity duration metadata. Sending anyway.") // Удалено
              }

              // Если длительность корректна (или Infinity), продолжаем шифрование и отправку
              const arrayBuffer = await audioBlob.arrayBuffer();
              // console.log("Recording stopped. Audio ArrayBuffer byteLength:", arrayBuffer.byteLength) // Удалено

              try {
                const encryptedContent = await encryptMessage(
                  arrayBuffer,
                  currentEncryptionKey
                );
                const response = await secureFetch("/send_message", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: CHAT_ID,
                    content: encryptedContent,
                    message_type: "audio",
                    is_ephemeral: ephemeralMode,
                  }),
                });
                const result = await response.json();
                if (result.success) {
                  // console.log("Voice message sent successfully!") // Удалено
                } else {
                  alert(
                    `Ошибка отправки голосового сообщения: ${result.message}`
                  );
                }
              } catch (error) {
                // console.error("Error sending voice message:", error) // Удалено
                alert("Произошла ошибка при отправке голосового сообщения.");
              } finally {
                audioStream.getTracks().forEach((track) => track.stop());
              }
            };

            tempAudio.onerror = (e) => {
              URL.revokeObjectURL(tempAudio.src); // Очищаем временный URL
              // console.error("Error loading temporary audio for duration check:", e) // Удалено
              alert(
                "Произошла ошибка при проверке записанного аудио. Пожалуйста, попробуйте еще раз."
              );
              // Сбрасываем UI
              recordAudioButton.style.display = "inline-flex";
              stopRecordingButton.style.display = "none";
              messageInput.style.display = "block";
              sendMessageButton.style.display = "inline-flex";
              recordingTimer.style.display = "none";
              clearInterval(recordingTimerInterval);
              recordingTimer.textContent = "0:00";
              audioStream.getTracks().forEach((track) => track.stop());
            };
          };

          mediaRecorder.onerror = (event) => {
            // console.error("MediaRecorder error:", event.error) // Удалено
            alert(
              `Ошибка записи аудио: ${event.error.name} - ${event.error.message}`
            );
            // Сбрасываем UI
            recordAudioButton.style.display = "inline-flex";
            stopRecordingButton.style.display = "none";
            messageInput.style.display = "block";
            sendMessageButton.style.display = "inline-flex";
            recordingTimer.style.display = "none";
            clearInterval(recordingTimerInterval);
            recordingTimer.textContent = "0:00";
            if (audioStream) {
              audioStream.getTracks().forEach((track) => track.stop());
            }
          };

          mediaRecorder.onwarning = (event) => {
            // console.warn("MediaRecorder warning:", event.message) // Удалено
          };

          // Начинаем запись с timeslice, чтобы получать данные каждые 1000 мс
          // console.log("MediaRecorder starting with timeslice 1000ms...") // Удалено
          mediaRecorder.start(1000); // Вернул timeslice к 1000 мс
          isRecording = true;
          recordAudioButton.style.display = "none";
          stopRecordingButton.style.display = "inline-flex";
          messageInput.style.display = "none"; // Скрываем текстовый ввод
          sendMessageButton.style.display = "none"; // Скрываем кнопку отправки текста
          recordingTimer.style.display = "inline-block";

          recordingStartTime = Date.now();
          recordingTimerInterval = setInterval(() => {
            const elapsedTime = Date.now() - recordingStartTime;
            const minutes = Math.floor(elapsedTime / 60000);
            const seconds = Math.floor((elapsedTime % 60000) / 1000);
            recordingTimer.textContent = `${minutes}:${seconds
              .toString()
              .padStart(2, "0")}`;
          }, 1000);
        } catch (err) {
          // console.error("Error accessing microphone:", err) // Удалено
          alert(
            "Не удалось получить доступ к микрофону. Пожалуйста, разрешите доступ."
          );
          // Сбрасываем UI, если не удалось получить доступ
          recordAudioButton.style.display = "inline-flex";
          stopRecordingButton.style.display = "none";
          messageInput.style.display = "block";
          sendMessageButton.style.display = "inline-flex";
          recordingTimer.style.display = "none";
          clearInterval(recordingTimerInterval);
        }
      });

      stopRecordingButton.addEventListener("click", () => {
        if (mediaRecorder && isRecording) {
          mediaRecorder.stop();
          isRecording = false;
          recordAudioButton.style.display = "inline-flex";
          stopRecordingButton.style.display = "none";
          messageInput.style.display = "block";
          sendMessageButton.style.display = "inline-flex";
          recordingTimer.style.display = "none";
          clearInterval(recordingTimerInterval);
          recordingTimer.textContent = "0:00"; // Сброс таймера
        }
      });
    }

    window.addEventListener("beforeunload", () => {
      if (CHAT_ID) {
        currentEncryptionKey = null;
        currentRawPassword = null;
        socket.emit("leave_chat_room", { chat_id: CHAT_ID });
        if (isTyping) {
          socket.emit("stop_typing", {
            chat_id: CHAT_ID,
            sender_id: CURRENT_USER_ID,
          });
        }
      }
      // Останавливаем запись, если пользователь уходит со страницы
      if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
        if (audioStream) {
          audioStream.getTracks().forEach((track) => track.stop());
        }
      }
    });
  }

  // --- Логика для страницы профиля (profile.html) ---
  const avatarUploadInput = document.getElementById("avatar-upload");
  let currentAvatarPreview = document.getElementById("current-avatar-preview");

  if (avatarUploadInput && currentAvatarPreview) {
    avatarUploadInput.addEventListener("change", function () {
      if (this.files && this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (currentAvatarPreview.tagName === "IMG") {
            currentAvatarPreview.src = e.target.result;
          } else {
            const img = document.createElement("img");
            img.src = e.target.result;
            img.alt = "Аватар пользователя";
            img.classList.add("profile-page__current-avatar");
            currentAvatarPreview.replaceWith(img);
            currentAvatarPreview = img;
          }
        };
        reader.readAsDataURL(this.files[0]);
      }
    });
  }

  const profileForm = document.querySelector(".profile-page__form");
  if (profileForm) {
    profileForm.querySelectorAll("input").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          profileForm.querySelector('button[type="submit"]')?.click();
        }
      });
    });
  }
});


