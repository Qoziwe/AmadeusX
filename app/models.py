from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar_url = db.Column(db.String(255), nullable=True)
    
    sent_invitations = db.relationship('Invitation', foreign_keys='Invitation.sender_id', backref='sender', lazy=True)
    received_invitations = db.relationship('Invitation', foreign_keys='Invitation.receiver_id', backref='receiver', lazy=True)
    
    chats_as_user1 = db.relationship('Chat', foreign_keys='Chat.user1_id', backref='user1', lazy=True)
    chats_as_user2 = db.relationship('Chat', foreign_keys='Chat.user2_id', backref='user2', lazy=True)
    
    messages = db.relationship('Message', foreign_keys='Message.sender_id', backref='message_sender', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def __repr__(self):
        return f'<User {self.username}>'

class Invitation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='pending', nullable=False)
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return f'<Invitation {self.sender.username} to {self.receiver.username} Status: {self.status}>'

class Chat(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user1_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user2_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=False, nullable=False)
    
    messages = db.relationship('Message', backref='chat', lazy=True)

    def __repr__(self):
        return f'<Chat {self.user1.username} & {self.user2.username}>'

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey('chat.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False) 
    message_type = db.Column(db.String(10), default='text', nullable=False) # 'text' или 'audio'
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)  # Coarse (±5 min) — точное время зашифровано внутри content клиентом
    expires_at = db.Column(db.DateTime, nullable=True) # Время автоматического удаления для исчезающих сообщений

    def __repr__(self):
        return f'<Message from {self.message_sender.username} in chat {self.chat_id}>'
