from app import app # Импортируем экземпляр Flask приложения
from models import db # Импортируем экземпляр SQLAlchemy


def refresh_database():
    """
    Полностью сносит все таблицы в базе данных и создает их заново.
    Используйте с осторожностью, так как это удалит все данные!
    """
    with app.app_context():
        confirm = input(
            "⚠️  ВНИМАНИЕ: Это действие удалит ВСЕ данные из базы данных!\n"
            "Введите 'YES' для подтверждения: "
        )
        if confirm != 'YES':
            print("Операция отменена.")
            return

        print("Удаление всех таблиц...")
        db.drop_all()
        print("Все таблицы удалены.")
        
        print("Создание таблиц заново...")
        db.create_all()
        print("Таблицы созданы заново.")
        print("База данных успешно обновлена!")

if __name__ == '__main__':
    refresh_database()
