export function parseFinanceQuery(text = "") {

    const q = text.toLowerCase().trim();
  
    if (
      q === "аналитика" ||
      q.includes("анализ") ||
      q.includes("трачу больше") ||
      q.includes("на что")
    ) {
      return {
        intent: "analytics",
        category: null,
        period: "all",
      };
    }
  
    if (q === "история") {
      return {
        intent: "history",
        category: null,
        period: "all",
      };
    }
  
    if (q === "баланс") {
      return {
        intent: "balance",
        category: null,
        period: "all",
      };
    }
  
    if (q === "статистика") {
      return {
        intent: "statistics",
        category: null,
        period: "all",
      };
    }
    if (
        q === "удали последнюю операцию" ||
        q === "удали последнюю транзакцию" ||
        q === "удали последний расход" ||
        q === "удали последний доход"
      ) {
        return {
          intent: "delete_last",
          category: null,
          period: "all",
        };
      }
    const result = {
      intent: null,
      category: null,
      period: "all",
    };
  
    if (q.includes("сегодня")) result.period = "today";
    else if (q.includes("недел")) result.period = "week";
    else if (q.includes("месяц")) result.period = "month";
  
    return result;
  }