# Архитектура

ALMAS строится как Framework.

Не как Telegram Bot.

Telegram — Adapter.

Архитектура

Telegram

↓

Pipeline

↓

Core

↓

Memory

↓

Storage

---

Core ничего не знает о Telegram.

Core ничего не знает о WhatsApp.

Core работает только с Context.

Все платформы являются адаптерами.

---

Основные модули

core/

pipeline/

memory/

providers/

services/

config/

---

Pipeline состоит из последовательности Step.

Каждый Step делает только одну задачу.

Например

validateInput

↓

loadYoutube

↓

loadTranscript

↓

generateSummary

↓

buildKnowledge

↓

saveKnowledge

Каждый Step получает Context.

Каждый Step возвращает Context.

Никаких глобальных зависимостей.