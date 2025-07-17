require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Створюємо папку для зберігання файлів якщо її немає
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log('📁 Створено папку data для зберігання заяв');
}

// Створюємо папку для PDF файлів
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('📁 Створено папку uploads для PDF файлів');
}

// Налаштування CORS для роботи з браузером
app.use(cors({
    origin: '*', // Дозволяємо всі домени для тестування
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Налаштування для обробки JSON з великими файлами (PDF)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Логування запитів
app.use((req, res, next) => {
    const timestamp = new Date().toLocaleString('uk-UA');
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

// ===== ДОДАЙ ЦІ РЯДКИ ТУТ =====
// Статичні файли для фронтенду
app.use(express.static(__dirname));

// Головна сторінка
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// ===== КІНЕЦЬ ДОДАВАННЯ =====

// Функція для читання заяв з файлу
function readApplications() {
    const today = new Date().toISOString().split('T')[0];
    const fileName = path.join(dataDir, `заяви_${today}.json`);
    
    try {
        if (fs.existsSync(fileName)) {
            const data = fs.readFileSync(fileName, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('❌ Помилка читання файлу заяв:', error);
        return [];
    }
}

// Функція для збереження заяв у файл
function saveApplications(applications) {
    const today = new Date().toISOString().split('T')[0];
    const fileName = path.join(dataDir, `заяви_${today}.json`);
    
    try {
        fs.writeFileSync(fileName, JSON.stringify(applications, null, 2), 'utf8');
        console.log(`💾 Заяви збережено в файл: ${fileName}`);
        return true;
    } catch (error) {
        console.error('❌ Помилка збереження файлу заяв:', error);
        return false;
    }
}

// Функція для збереження PDF файлу
function savePDFFile(pdfBase64, applicationNumber, fullName) {
    if (!pdfBase64) return null;
    
    try {
        console.log('📄 Початок збереження PDF...');
        
        // Перевіряємо формат base64
        let base64Data;
        if (pdfBase64.startsWith('data:application/pdf;base64,')) {
            base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
        } else if (pdfBase64.startsWith('data:')) {
            // Якщо це інший MIME type, витягуємо base64 частину
            base64Data = pdfBase64.split(',')[1];
        } else {
            // Якщо це вже чистий base64
            base64Data = pdfBase64;
        }
        
        // Перевіряємо чи base64 валідний
        if (!base64Data || base64Data.length === 0) {
            console.error('❌ Порожній base64 рядок');
            return null;
        }
        
        // Створюємо ім'я файлу
        const sanitizedName = fullName.replace(/[^а-яА-ЯіІїЇєЄa-zA-Z0-9]/g, '_');
        const fileName = `${applicationNumber}_${sanitizedName}.pdf`;
        const filePath = path.join(uploadsDir, fileName);
        
        // Зберігаємо файл
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
        
        // Перевіряємо розмір файлу
        const stats = fs.statSync(filePath);
        console.log(`📄 PDF збережено: ${fileName} (${(stats.size / 1024).toFixed(2)} KB)`);
        
        // Базова перевірка PDF заголовка
        const fileBuffer = fs.readFileSync(filePath);
        if (fileBuffer.slice(0, 4).toString() === '%PDF') {
            console.log('✅ PDF файл валідний');
        } else {
            console.warn('⚠️ PDF файл може бути пошкоджений (немає PDF заголовка)');
        }
        
        return fileName;
    } catch (error) {
        console.error('❌ Помилка збереження PDF:', error);
        return null;
    }
}

// Головна сторінка - інформація про API
app.get('/', (req, res) => {
    res.json({
        message: 'API для системи заявок на видалення дерев',
        version: '1.0.0',
        endpoints: {
            health: 'GET /health',
            applications: {
                create: 'POST /api/applications',
                list: 'GET /api/applications',
                stats: 'GET /api/applications/stats'
            }
        },
        status: 'Працює'
    });
});

// Перевірка здоров'я сервера
app.get('/health', (req, res) => {
    console.log('✅ Health check викликано');
    res.json({
        status: 'OK',
        message: 'Сервер працює!',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Створення нової заяви
app.post('/api/applications', (req, res) => {
    try {
        console.log('📥 Отримано POST запит на /api/applications');
        
        const {
            fullName,
            address,
            phone,
            treeAddress,
            treeType,
            treeAge,
            threat,
            pdfBase64
        } = req.body;

        // Валідація обов'язкових полів
        if (!fullName || !address || !treeAddress || !treeType || !threat) {
            return res.status(400).json({
                success: false,
                error: 'Не всі обов\'язкові поля заповнені',
                required: ['fullName', 'address', 'treeAddress', 'treeType', 'threat']
            });
        }

        // Генеруємо унікальний номер заяви
        const timestamp = Date.now();
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const applicationNumber = `TREE-${date}-${timestamp.toString().slice(-6)}`;

        // Зберігаємо PDF файл якщо є
        const pdfFileName = savePDFFile(pdfBase64, applicationNumber, fullName);

        // Створюємо об'єкт заяви
        const application = {
            id: applicationNumber,
            applicationNumber,
            fullName,
            address,
            phone: phone || null,
            treeAddress,
            treeType,
            treeAge: treeAge || null,
            threat,
            pdfFileName,
            status: 'нова',
            submittedAt: new Date().toISOString(),
            submittedDate: new Date().toLocaleDateString('uk-UA'),
            submittedTime: new Date().toLocaleTimeString('uk-UA')
        };

        // Читаємо існуючі заяви
        const applications = readApplications();
        
        // Додаємо нову заяву
        applications.push(application);
        
        // Зберігаємо оновлений список
        const saved = saveApplications(applications);
        
        if (!saved) {
            return res.status(500).json({
                success: false,
                error: 'Помилка збереження заяви на сервері'
            });
        }

        // Логуємо успішне створення
        console.log('📋 Дані заяви:', {
            applicationNumber,
            fullName,
            address: address.substring(0, 50) + '...',
            treeAddress: treeAddress.substring(0, 50) + '...',
            treeType,
            hasPDF: !!pdfFileName
        });

        // Відправляємо успішну відповідь
        res.status(201).json({
            success: true,
            message: 'Заяву успішно створено та збережено',
            applicationNumber,
            submittedAt: application.submittedAt,
            pdfSaved: !!pdfFileName
        });

    } catch (error) {
        console.error('❌ Помилка створення заяви:', error);
        res.status(500).json({
            success: false,
            error: 'Внутрішня помилка сервера',
            details: error.message
        });
    }
});

// Отримання списку заяв
app.get('/api/applications', (req, res) => {
    try {
        console.log('📥 Отримано GET запит на /api/applications');
        
        const applications = readApplications();
        
        // Сортуємо за датою (нові спочатку)
        applications.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        
        console.log(`📊 Повернуто ${applications.length} заяв`);
        
        res.json({
            success: true,
            data: applications,
            count: applications.length,
            message: applications.length > 0 
                ? `Знайдено ${applications.length} заяв` 
                : 'Заяв сьогодні ще немає'
        });

    } catch (error) {
        console.error('❌ Помилка отримання заяв:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка читання заяв',
            details: error.message
        });
    }
});

// Статистика заяв
app.get('/api/applications/stats', (req, res) => {
    try {
        const applications = readApplications();
        
        const stats = {
            total: applications.length,
            byStatus: {
                нова: applications.filter(app => app.status === 'нова').length,
                в_роботі: applications.filter(app => app.status === 'в_роботі').length,
                виконана: applications.filter(app => app.status === 'виконана').length,
                відхилена: applications.filter(app => app.status === 'відхилена').length
            },
            byTreeType: {},
            withPDF: applications.filter(app => app.pdfFileName).length,
            todayDate: new Date().toLocaleDateString('uk-UA')
        };

        // Рахуємо за типами дерев
        applications.forEach(app => {
            const type = app.treeType || 'Не вказано';
            stats.byTreeType[type] = (stats.byTreeType[type] || 0) + 1;
        });

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('❌ Помилка отримання статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка отримання статистики'
        });
    }
});

// Скачування PDF файлу заяви
app.get('/api/applications/:id/pdf', (req, res) => {
    try {
        const { id } = req.params;
        const applications = readApplications();
        const application = applications.find(app => app.applicationNumber === id);

        if (!application || !application.pdfFileName) {
            return res.status(404).json({
                success: false,
                error: 'PDF файл не знайдено'
            });
        }

        const filePath = path.join(uploadsDir, application.pdfFileName);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'PDF файл не знайдено на сервері'
            });
        }

        const fileName = `Заява_${application.fullName.replace(/\s/g, '_')}.pdf`;
        res.download(filePath, fileName);

    } catch (error) {
        console.error('❌ Помилка скачування PDF:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка скачування файлу'
        });
    }
});

// Статичні файли (для прямого доступу до uploads)
app.use('/uploads', express.static(uploadsDir));

// Обробка неіснуючих маршрутів
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не знайдено',
        requestedUrl: req.originalUrl,
        availableEndpoints: [
            'GET /',
            'GET /health',
            'GET /api/applications',
            'POST /api/applications',
            'GET /api/applications/stats',
            'GET /api/applications/:id/pdf'
        ]
    });
});

// Глобальна обробка помилок
app.use((err, req, res, next) => {
    console.error('💥 Глобальна помилка:', err);
    
    res.status(500).json({
        success: false,
        error: 'Щось пішло не так!',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Запуск сервера
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Сервер запущено успішно!');
    console.log('='.repeat(50));
    console.log(`📍 Порт: ${PORT}`);
    console.log(`🏥 Health check: /health`);
    console.log(`📋 API заяв: /api/applications`);
    console.log(`📊 Статистика: /api/applications/stats`);
    console.log(`🌍 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(50));
    console.log('✨ Готовий до роботи!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Отримано сигнал SIGTERM. Закриваю сервер...');
    server.close(() => {
        console.log('✅ Сервер закрито');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 Отримано сигнал SIGINT (Ctrl+C). Закриваю сервер...');
    server.close(() => {
        console.log('✅ Сервер закрито');
        process.exit(0);
    });
});
