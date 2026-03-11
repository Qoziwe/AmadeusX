import os
import re
import uuid
import hashlib
import base64
import logging
import filetype
from datetime import datetime, timedelta
from flask import Flask, render_template, redirect, url_for, request, flash, jsonify, send_from_directory
from flask_login import LoginManager, current_user, login_required, login_user, logout_user
from werkzeug.security import generate_password_hash
from models import db, User, Invitation, Chat, Message
from sqlalchemy import or_
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from dotenv import load_dotenv
from collections import defaultdict
import time

# Загрузка переменных окружения из .env
load_dotenv()


def compute_sri_hash(filepath):
    """Вычисляет SRI-хеш (SHA-384) для файла."""
    sha384 = hashlib.sha384()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            sha384.update(chunk)
    return 'sha384-' + base64.b64encode(sha384.digest()).decode('utf-8')


def coarse_timestamp():
    """Возвращает время, огрублённое до ближайших 5 минут.
    Скрывает точное время отправки сообщения на стороне сервера."""
    now = datetime.utcnow()
    minute = (now.minute // 5) * 5
    return now.replace(minute=minute, second=0, microsecond=0)


app = Flask(__name__)

# ======================= КОНФИГУРАЦИЯ БЕЗОПАСНОСТИ =======================

# Секретный ключ из переменной окружения
app.secret_key = os.environ.get('SECRET_KEY')
if not app.secret_key:
    raise RuntimeError("SECRET_KEY не задан в .env файле!")

# Настройки сессии (production-ready через переменные окружения)
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('COOKIE_SECURE', 'True').lower() == 'true'
app.config['SESSION_COOKIE_HTTPONLY'] = True     # Недоступна для JavaScript
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'   # Защита от CSRF через куки

# Подключение к PostgreSQL из переменных окружения
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URI')
if not app.config['SQLALCHEMY_DATABASE_URI']:
    raise RuntimeError("DATABASE_URI не задан в .env файле!")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Ограничение размера загружаемых файлов — 2 МБ
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024

# =====================================================================

# CSRF-защита
csrf = CSRFProtect(app)

# Rate Limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Настройка Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'auth'

# Заголовки безопасности (Talisman)
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://amadeusx.duckdns.org')

# Определение протокола WebSocket (wss:// для production, ws:// для локалки)
_cors_host = CORS_ORIGIN.replace('http://', '').replace('https://', '')
_ws_protocol = 'wss' if CORS_ORIGIN.startswith('https') else 'ws'

csp = {
    'default-src': "'self'",
    'script-src': ["'self'", "https://cdnjs.cloudflare.com"],
    'style-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    'font-src': ["'self'", "https://fonts.gstatic.com"],
    'img-src': ["'self'", "data:", "blob:"],
    'media-src': ["'self'", "blob:"],
    'connect-src': ["'self'", CORS_ORIGIN, f"{_ws_protocol}://{_cors_host}", "https://cdnjs.cloudflare.com"],
}

_force_https = os.environ.get('FORCE_HTTPS', 'True').lower() == 'true'
_cookie_secure = os.environ.get('COOKIE_SECURE', 'True').lower() == 'true'

talisman = Talisman(
    app,
    content_security_policy=csp,
    force_https=_force_https,
    session_cookie_secure=_cookie_secure,
    content_security_policy_nonce_in=['script-src'],
)

# Настройка папки для загрузки аватаров
UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads', 'avatars')
# Убран SVG — это вектор XSS-атак
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'}
ALLOWED_MIME_TYPES = {
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon'
}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

db.init_app(app)

# Режим debug из переменной окружения
is_debug = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'

# Вычисляем SRI-хеш scripts.js при старте сервера
SCRIPTS_JS_PATH = os.path.join(app.root_path, 'static', 'scripts', 'scripts.js')
SCRIPTS_JS_SRI = compute_sri_hash(SCRIPTS_JS_PATH) if os.path.exists(SCRIPTS_JS_PATH) else ''

# Настройка логирования безопасности
security_logger = logging.getLogger('security')
security_logger.setLevel(logging.INFO)
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter('[%(asctime)s] SECURITY %(levelname)s: %(message)s'))
security_logger.addHandler(_handler)


@app.context_processor
def inject_sri_hashes():
    """Инъекция SRI-хешей во все шаблоны. В debug-режиме SRI отключается."""
    if is_debug:
        return {'scripts_js_hash': ''}  # SRI отключен в debug-режиме
    return {'scripts_js_hash': SCRIPTS_JS_SRI}


@app.route('/sw.js')
def service_worker():
    """Service Worker должен обслуживаться из корня для максимального scope."""
    return send_from_directory(os.path.join(app.root_path, 'static'), 'sw.js',
                               mimetype='application/javascript')

socketio = SocketIO(app,
                    cors_allowed_origins=[CORS_ORIGIN],
                    logger=is_debug,
                    engineio_logger=is_debug,
                    async_mode='threading')


# === ВАЛИДАЦИЯ ФАЙЛОВ ===

def allowed_file(filename):
    """Проверка расширения файла."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_file_content(file_stream):
    """Проверка MIME-типа файла по содержимому (magic bytes)."""
    header = file_stream.read(2048)
    file_stream.seek(0)
    kind = filetype.guess(header)
    return kind is not None and kind.mime in ALLOWED_MIME_TYPES


def validate_password_strength(password):
    """Проверка сложности пароля: ≥8, ≤128 символов, буквы + цифры."""
    if len(password) < 8:
        return False, 'Пароль должен быть не менее 8 символов.'
    if len(password) > 128:
        return False, 'Пароль не может быть длиннее 128 символов.'
    if not any(c.isalpha() for c in password):
        return False, 'Пароль должен содержать хотя бы одну букву.'
    if not any(c.isdigit() for c in password):
        return False, 'Пароль должен содержать хотя бы одну цифру.'
    return True, ''


def validate_username(username):
    """Проверка имени пользователя: 2-80 символов, только буквы, цифры, подчёркивания."""
    if len(username) < 2 or len(username) > 80:
        return False, 'Имя пользователя должно быть от 2 до 80 символов.'
    if not re.match(r'^[a-zA-Zа-яА-ЯёЁ0-9_]+$', username):
        return False, 'Имя пользователя может содержать только буквы, цифры и подчёркивания.'
    return True, ''


def validate_email(email):
    """Базовая проверка формата email."""
    if len(email) > 120:
        return False, 'Email слишком длинный.'
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return False, 'Неверный формат email.'
    return True, ''


def escape_sql_wildcards(value):
    """Экранирование SQL wildcard символов % и _ для LIKE/ILIKE запросов."""
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


# Максимальный размер сообщения (1 МБ для аудио, 10 КБ для текста)
MAX_TEXT_MESSAGE_SIZE = 10 * 1024       # 10 КБ
MAX_AUDIO_MESSAGE_SIZE = 1 * 1024 * 1024  # 1 МБ


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('home'))
    return render_template('index.html')


@app.route('/auth')
def auth():
    if current_user.is_authenticated:
        return redirect(url_for('home'))
    return render_template('auth.html')


@app.route('/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    email = request.form.get('email', '').strip()
    password = request.form.get('password', '')

    user = User.query.filter_by(email=email).first()

    if user and user.check_password(password):
        security_logger.info(f'Successful login: {email} from {get_remote_address()}')
        login_user(user)
        return redirect(url_for('home'))
    else:
        # Timing-safe: выполняем фиктивный хеш, чтобы время ответа было одинаковым
        if not user:
            generate_password_hash('dummy_password_for_timing_safety')
        security_logger.warning(f'Failed login attempt: {email} from {get_remote_address()}')
        flash('Неверный email или пароль')
        return redirect(url_for('auth'))


@app.route('/register', methods=['POST'])
@limiter.limit("3 per minute")
def register():
    username = request.form.get('username', '').strip()
    email = request.form.get('email', '').strip()
    password = request.form.get('password', '')
    confirm_password = request.form.get('confirm_password', '')

    # Валидация имени пользователя
    is_valid, error_msg = validate_username(username)
    if not is_valid:
        flash(error_msg)
        return redirect(url_for('auth'))

    # Валидация email
    is_valid, error_msg = validate_email(email)
    if not is_valid:
        flash(error_msg)
        return redirect(url_for('auth'))

    if password != confirm_password:
        flash('Пароли не совпадают')
        return redirect(url_for('auth'))

    # Проверка сложности пароля
    is_valid, error_msg = validate_password_strength(password)
    if not is_valid:
        flash(error_msg)
        return redirect(url_for('auth'))

    # Общее сообщение об ошибке для предотвращения перечисления пользователей
    if User.query.filter_by(email=email).first() or User.query.filter_by(username=username).first():
        flash('Регистрация с указанными данными невозможна. Попробуйте другие.')
        return redirect(url_for('auth'))

    user = User(username=username, email=email)
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    security_logger.info(f'New user registered: {username} from {get_remote_address()}')
    login_user(user)
    return redirect(url_for('home'))


@app.route('/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))


@app.route('/home')
@login_required
def home():
    user_chats = Chat.query.filter(
        or_(Chat.user1_id == current_user.id, Chat.user2_id == current_user.id),
        Chat.is_active == True
    ).all()

    pending_invitations = Invitation.query.filter_by(
        receiver_id=current_user.id, status='pending'
    ).all()

    return render_template('home.html',
                           user_chats=user_chats,
                           pending_invitations=pending_invitations)


@app.route('/search_users', methods=['GET'])
@login_required
@limiter.limit("20 per minute")
def search_users():
    query = request.args.get('q', '').strip()
    if query and len(query) >= 2:
        # Экранирование SQL wildcard символов для защиты от information disclosure
        safe_query = escape_sql_wildcards(query)
        users = User.query.filter(
            User.username.ilike(f'%{safe_query}%', escape='\\'),
            User.id != current_user.id
        ).limit(10).all()

        users_data = []
        for user in users:
            existing_chat = Chat.query.filter(
                or_(
                    (Chat.user1_id == current_user.id) & (Chat.user2_id == user.id),
                    (Chat.user1_id == user.id) & (Chat.user2_id == current_user.id)
                ),
                Chat.is_active == True
            ).first()

            pending_invitation = Invitation.query.filter(
                or_(
                    (Invitation.sender_id == current_user.id) & (Invitation.receiver_id == user.id),
                    (Invitation.sender_id == user.id) & (Invitation.receiver_id == current_user.id)
                ),
                Invitation.status == 'pending'
            ).first()

            users_data.append({
                'id': user.id,
                'username': user.username,
                'avatar_url': user.avatar_url,
                'has_chat': bool(existing_chat),
                'has_pending_invitation': bool(pending_invitation)
            })
        return jsonify(users_data)
    return jsonify([])


@app.route('/send_invitation', methods=['POST'])
@login_required
@limiter.limit("10 per minute")
def send_invitation():
    receiver_id = request.json.get('receiver_id')
    if not receiver_id:
        return jsonify({'success': False, 'message': 'Receiver ID is required'}), 400

    receiver = User.query.get(receiver_id)
    if not receiver:
        return jsonify({'success': False, 'message': 'User not found'}), 404

    if receiver.id == current_user.id:
        return jsonify({'success': False, 'message': 'Cannot send invitation to yourself'}), 400

    existing_chat = Chat.query.filter(
        or_(
            (Chat.user1_id == current_user.id) & (Chat.user2_id == receiver.id),
            (Chat.user1_id == receiver.id) & (Chat.user2_id == current_user.id)
        ),
        Chat.is_active == True
    ).first()

    pending_invitation = Invitation.query.filter(
        or_(
            (Invitation.sender_id == current_user.id) & (Invitation.receiver_id == receiver.id),
            (Invitation.sender_id == receiver.id) & (Invitation.receiver_id == current_user.id)
        ),
        Invitation.status == 'pending'
    ).first()

    if existing_chat or pending_invitation:
        return jsonify({'success': False, 'message': 'Chat or pending invitation already exists with this user.'}), 409

    invitation = Invitation(sender_id=current_user.id, receiver_id=receiver.id)
    db.session.add(invitation)
    db.session.commit()

    socketio.emit('new_invitation', {
        'invitation_id': invitation.id,
        'sender_id': current_user.id,
        'sender_username': current_user.username,
        'sender_avatar_url': current_user.avatar_url
    }, room=str(receiver.id))

    return jsonify({'success': True, 'message': 'Invitation sent successfully!'})


@app.route('/accept_invitation/<int:invitation_id>', methods=['POST'])
@login_required
def accept_invitation(invitation_id):
    invitation = Invitation.query.get(invitation_id)

    if not invitation or invitation.receiver_id != current_user.id or invitation.status != 'pending':
        return jsonify({'success': False, 'message': 'Invitation not found or not valid.'}), 404

    existing_chat = Chat.query.filter(
        or_(
            (Chat.user1_id == invitation.sender_id) & (Chat.user2_id == invitation.receiver_id),
            (Chat.user1_id == invitation.receiver_id) & (Chat.user2_id == invitation.sender_id)
        ),
        Chat.is_active == True
    ).first()

    if existing_chat:
        invitation.status = 'rejected'
        db.session.commit()
        return jsonify({'success': False, 'message': 'Chat already exists with this user.'}), 409

    chat = Chat(user1_id=invitation.sender_id, user2_id=invitation.receiver_id, is_active=True)
    db.session.add(chat)

    invitation.status = 'accepted'
    db.session.commit()

    chat_info = {
        'chat_id': chat.id,
        'user1_id': chat.user1_id,
        'user2_id': chat.user2_id,
        'user1_username': chat.user1.username,
        'user2_username': chat.user2.username,
        'user1_avatar_url': chat.user1.avatar_url,
        'user2_avatar_url': chat.user2.avatar_url
    }
    socketio.emit('chat_created', chat_info, room=str(chat.user1_id))
    socketio.emit('chat_created', chat_info, room=str(chat.user2_id))

    socketio.emit('invitation_accepted', {
        'invitation_id': invitation.id,
        'receiver_id': current_user.id,
        'receiver_username': current_user.username,
        'chat_id': chat.id
    }, room=str(invitation.sender_id))

    return jsonify({'success': True, 'message': 'Invitation accepted, chat created!', 'chat_id': chat.id})


@app.route('/chat/<int:chat_id>')
@login_required
def chat_page(chat_id):
    chat = Chat.query.get(chat_id)

    if not chat or not chat.is_active or \
       (chat.user1_id != current_user.id and chat.user2_id != current_user.id):
        flash('Чат не найден или у вас нет доступа.')
        return redirect(url_for('home'))

    other_user = chat.user1 if chat.user2_id == current_user.id else chat.user2

    messages = Message.query.filter_by(chat_id=chat.id).order_by(Message.timestamp.asc()).limit(50).all()

    return render_template('chat.html',
                           chat=chat,
                           other_user=other_user,
                           messages=messages,
                           current_user_avatar_url=current_user.avatar_url,
                           other_user_avatar_url=other_user.avatar_url)


@app.route('/send_message', methods=['POST'])
@login_required
@limiter.limit("30 per minute")
def send_message():
    chat_id = request.json.get('chat_id')
    encrypted_content = request.json.get('content')
    message_type = request.json.get('message_type', 'text')
    is_ephemeral = request.json.get('is_ephemeral', False)

    chat = Chat.query.get(chat_id)

    if not chat or not chat.is_active or \
       (chat.user1_id != current_user.id and chat.user2_id != current_user.id):
        return jsonify({'success': False, 'message': 'Chat not found or not authorized.'}), 403

    if not encrypted_content:
        return jsonify({'success': False, 'message': 'Message content is empty.'}), 400

    # Валидация типа сообщения
    if message_type not in ('text', 'audio'):
        return jsonify({'success': False, 'message': 'Invalid message type.'}), 400

    # Проверка лимита размера сообщения
    content_size = len(encrypted_content.encode('utf-8'))
    if message_type == 'text' and content_size > MAX_TEXT_MESSAGE_SIZE:
        return jsonify({'success': False, 'message': 'Текстовое сообщение слишком большое.'}), 413
    elif message_type == 'audio' and content_size > MAX_AUDIO_MESSAGE_SIZE:
        return jsonify({'success': False, 'message': 'Аудиосообщение слишком большое.'}), 413

    # Огрублённый timestamp — точное время зашифровано внутри сообщения клиентом
    expires_at = datetime.utcnow() + timedelta(seconds=30) if is_ephemeral else None
    message = Message(chat_id=chat.id, sender_id=current_user.id, content=encrypted_content,
                      message_type=message_type, timestamp=coarse_timestamp(), expires_at=expires_at)
    db.session.add(message)
    db.session.commit()

    message_data = {
        'id': message.id,
        'chat_id': message.chat_id,
        'sender_id': message.sender_id,
        'sender_username': message.message_sender.username,
        'sender_avatar_url': message.message_sender.avatar_url,
        'content': message.content,
        'message_type': message.message_type,
        'timestamp': message.timestamp.isoformat()
    }
    socketio.emit('new_message', message_data, room=str(chat.id))

    return jsonify({'success': True, 'message': 'Message sent.'})


@app.route('/delete_message/<int:message_id>', methods=['POST'])
@login_required
@limiter.limit("60 per minute")
def delete_message(message_id):
    """Удаление сообщения (для исчезающих сообщений)."""
    message = Message.query.get(message_id)

    if not message:
        return jsonify({'success': False, 'message': 'Message not found.'}), 404

    if message.sender_id != current_user.id:
        return jsonify({'success': False, 'message': 'Not authorized to delete this message.'}), 403

    chat = Chat.query.get(message.chat_id)
    if not chat or (chat.user1_id != current_user.id and chat.user2_id != current_user.id):
        return jsonify({'success': False, 'message': 'Not authorized.'}), 403

    db.session.delete(message)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Message deleted.'})


@app.route('/get_messages/<int:chat_id>', methods=['GET'])
@login_required
@limiter.limit("60 per minute")
def get_messages(chat_id):
    chat = Chat.query.get(chat_id)

    if not chat or not chat.is_active or \
       (chat.user1_id != current_user.id and chat.user2_id != current_user.id):
        return jsonify({'success': False, 'message': 'Chat not found or not authorized.'}), 403

    # Удаление истекших сообщений (очистка)
    expired_messages = Message.query.filter(Message.chat_id == chat.id, Message.expires_at <= datetime.utcnow()).all()
    if expired_messages:
        for msg in expired_messages:
            db.session.delete(msg)
        db.session.commit()

    last_message_id = request.args.get('last_id', 0, type=int)

    messages = Message.query.filter(
        Message.chat_id == chat.id,
        Message.id > last_message_id,
        db.or_(Message.expires_at == None, Message.expires_at > datetime.utcnow())
    ).order_by(Message.timestamp.asc()).limit(50).all()

    messages_data = []
    for msg in messages:
        messages_data.append({
            'id': msg.id,
            'sender_id': msg.sender_id,
            'sender_username': msg.message_sender.username,
            'sender_avatar_url': msg.message_sender.avatar_url,
            'content': msg.content,
            'message_type': msg.message_type,
            'timestamp': msg.timestamp.isoformat()
        })

    return jsonify(messages_data)


@app.route('/delete_chat/<int:chat_id>', methods=['POST'])
@login_required
def delete_chat(chat_id):
    chat = Chat.query.get(chat_id)

    if not chat or (chat.user1_id != current_user.id and chat.user2_id != current_user.id):
        return jsonify({'success': False, 'message': 'Chat not found or not authorized.'}), 403

    other_user_id = chat.user1_id if chat.user2_id == current_user.id else chat.user2_id

    security_logger.info(f'Chat {chat_id} deleted by user {current_user.id} from {get_remote_address()}')

    Message.query.filter_by(chat_id=chat.id).delete()
    db.session.delete(chat)
    db.session.commit()

    socketio.emit('chat_deleted', {
        'chat_id': chat_id,
        'deleted_by_user_id': current_user.id,
        'other_user_id': other_user_id
    }, room=str(current_user.id))
    socketio.emit('chat_deleted', {
        'chat_id': chat_id,
        'deleted_by_user_id': current_user.id,
        'other_user_id': other_user_id
    }, room=str(other_user_id))

    return jsonify({'success': True, 'message': 'Chat deleted successfully.'})


@app.route('/profile', methods=['GET'])
@login_required
def profile():
    return render_template('profile.html', user=current_user)


@app.route('/profile/edit', methods=['POST'])
@login_required
@limiter.limit("10 per minute")
def edit_profile():
    new_username = request.form.get('username', '').strip()
    new_email = request.form.get('email', '').strip()
    new_password = request.form.get('new_password', '')
    confirm_new_password = request.form.get('confirm_new_password', '')

    user = current_user

    if new_username and new_username != user.username:
        is_valid, error_msg = validate_username(new_username)
        if not is_valid:
            flash(error_msg, 'error')
            return redirect(url_for('profile'))
        if User.query.filter_by(username=new_username).first():
            flash('Имя пользователя уже занято.', 'error')
            return redirect(url_for('profile'))
        user.username = new_username

    if new_email and new_email != user.email:
        is_valid, error_msg = validate_email(new_email)
        if not is_valid:
            flash(error_msg, 'error')
            return redirect(url_for('profile'))
        if User.query.filter_by(email=new_email).first():
            flash('Email уже занят.', 'error')
            return redirect(url_for('profile'))
        user.email = new_email

    if new_password:
        if new_password != confirm_new_password:
            flash('Новые пароли не совпадают.', 'error')
            return redirect(url_for('profile'))
        is_valid, error_msg = validate_password_strength(new_password)
        if not is_valid:
            flash(error_msg, 'error')
            return redirect(url_for('profile'))
        user.set_password(new_password)
        security_logger.info(f'Password changed for user {user.id} from {get_remote_address()}')
        flash('Пароль успешно изменен.', 'success')

    if 'avatar' in request.files:
        file = request.files['avatar']
        if file.filename == '':
            flash('Файл аватара не выбран.', 'warning')
        elif file and allowed_file(file.filename):
            # Проверка MIME-типа по содержимому файла
            if not validate_file_content(file):
                flash('Содержимое файла не соответствует допустимому типу изображения.', 'error')
                return redirect(url_for('profile'))

            if user.avatar_url:
                filename = os.path.basename(user.avatar_url)
                full_old_avatar_path = os.path.join(app.root_path, 'static', 'uploads', 'avatars', filename)

                if os.path.exists(full_old_avatar_path) and os.path.isfile(full_old_avatar_path):
                    try:
                        os.remove(full_old_avatar_path)
                    except Exception:
                        pass  # Не раскрываем ошибки файловой системы

            # Безопасное имя файла — UUID
            filename = str(uuid.uuid4()) + os.path.splitext(file.filename)[1].lower()
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            user.avatar_url = url_for('static', filename=f'uploads/avatars/{filename}')
            flash('Аватар успешно обновлен.', 'success')
        else:
            flash('Недопустимый тип файла для аватара.', 'error')

    try:
        db.session.commit()
        flash('Профиль успешно обновлен.', 'success')
    except Exception:
        db.session.rollback()
        flash('Ошибка при обновлении профиля.', 'error')

    return redirect(url_for('profile'))


@app.route('/profile/delete_avatar', methods=['POST'])
@login_required
def delete_avatar():
    user = current_user

    if not user.avatar_url:
        flash('У вас нет аватара для удаления', 'warning')
        return redirect(url_for('profile'))

    try:
        if user.avatar_url:
            filename = os.path.basename(user.avatar_url)
            full_avatar_path = os.path.join(app.root_path, 'static', 'uploads', 'avatars', filename)

            if os.path.exists(full_avatar_path) and os.path.isfile(full_avatar_path):
                os.remove(full_avatar_path)

        user.avatar_url = None
        db.session.commit()

        flash('Аватар успешно удален', 'success')
    except Exception:
        db.session.rollback()
        flash('Ошибка при удалении аватара.', 'error')

    return redirect(url_for('profile'))


# === Socket.IO обработчики ===

@socketio.on('connect')
@login_required
def handle_connect():
    join_room(str(current_user.id))


@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        leave_room(str(current_user.id))
        _socketio_rate_limits.pop(current_user.id, None)


@socketio.on('join_chat_room')
@login_required
def handle_join_chat_room(data):
    chat_id = data.get('chat_id')
    if chat_id:
        chat = Chat.query.get(chat_id)
        if chat and (chat.user1_id == current_user.id or chat.user2_id == current_user.id):
            join_room(str(chat.id))


@socketio.on('join_user_room')
@login_required
def handle_join_user_room(data):
    join_room(str(current_user.id))


@socketio.on('leave_chat_room')
@login_required
def handle_leave_chat_room(data):
    chat_id = data.get('chat_id')
    if chat_id:
        leave_room(str(chat_id))


# --- Socket.IO Rate Limiting ---
_socketio_rate_limits = defaultdict(lambda: {'count': 0, 'reset_time': time.time() + 10})
SOCKETIO_MAX_EVENTS_PER_10S = 30


def check_socketio_rate_limit(user_id):
    """Примитивный rate limiter для Socket.IO событий."""
    now = time.time()
    entry = _socketio_rate_limits[user_id]
    if now > entry['reset_time']:
        entry['count'] = 0
        entry['reset_time'] = now + 10
    entry['count'] += 1
    return entry['count'] <= SOCKETIO_MAX_EVENTS_PER_10S


@socketio.on('typing')
@login_required
def handle_typing(data):
    if not check_socketio_rate_limit(current_user.id):
        return  # rate limit exceeded
    chat_id = data.get('chat_id')
    # Проверяем, что пользователь — участник чата, используем current_user.id вместо присланного sender_id
    chat = Chat.query.get(chat_id)
    if chat and (chat.user1_id == current_user.id or chat.user2_id == current_user.id):
        emit('typing', {'chat_id': chat_id, 'sender_id': current_user.id}, room=str(chat_id), skip_sid=request.sid)


@socketio.on('stop_typing')
@login_required
def handle_stop_typing(data):
    if not check_socketio_rate_limit(current_user.id):
        return  # rate limit exceeded
    chat_id = data.get('chat_id')
    chat = Chat.query.get(chat_id)
    if chat and (chat.user1_id == current_user.id or chat.user2_id == current_user.id):
        emit('stop_typing', {'chat_id': chat_id, 'sender_id': current_user.id}, room=str(chat_id), skip_sid=request.sid)


with app.app_context():
    db.create_all()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8000, debug=is_debug)