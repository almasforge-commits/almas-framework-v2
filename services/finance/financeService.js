import { supabase } from "../../providers/storage/supabase.js";

export async function addExpense({
  amount,
  category,
  description = "",
  currency = "RUB",
  user_id = "default",
  batch_id = null,
}) {
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert({
      type: "expense",
      amount,
      currency,
      category,
      description,
      user_id,
      batch_id,
    })
    .select()
    .single();

  if (error) {
    console.error("Ошибка добавления расхода:", error);
    return null;
  }

  return data;
}

export async function addIncome({
  amount,
  category,
  description = "",
  currency = "RUB",
  user_id = "default",
  batch_id = null,
}) {
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert({
      type: "income",
      amount,
      currency,
      category,
      description,
      user_id,
      batch_id,
    })
    .select()
    .single();

  if (error) {
    console.error("Ошибка добавления дохода:", error);
    return null;
  }

  return data;
}

export async function getTransactions(limit = 20) {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error);
    return [];
  }

  return data;
}
export async function getBalance(user_id = "default") {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("type, amount, currency")
    .eq("user_id", user_id);

  if (error) {
    console.error(error);
    return {};
  }

  const result = {};
  const rows = Array.isArray(data) ? data : [];

  for (const item of rows) {
    const currency = item.currency || "VND";

    if (!result[currency]) {
      result[currency] = {
        income: 0,
        expense: 0,
        balance: 0,
      };
    }

    if (item.type === "income") {
      result[currency].income += Number(item.amount);
    }

    if (item.type === "expense") {
      result[currency].expense += Number(item.amount);
    }

    result[currency].balance =
      result[currency].income - result[currency].expense;
  }

  return result;
}

export async function getHistory(user_id = "default", limit = 10) {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

export async function getStatistics(user_id = "default") {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("user_id", user_id);

  if (error) {
    console.error(error);
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  const stats = {
    transactions: rows.length,
    expenses: {},
    incomes: {},
    biggestExpense: null,
  };

  for (const item of rows) {
    const currency = item.currency || "VND";

    if (!stats.expenses[currency]) stats.expenses[currency] = 0;
    if (!stats.incomes[currency]) stats.incomes[currency] = 0;

    if (item.type === "expense") {
      stats.expenses[currency] += Number(item.amount);

      if (
        !stats.biggestExpense ||
        Number(item.amount) > Number(stats.biggestExpense.amount)
      ) {
        stats.biggestExpense = item;
      }
    }

    if (item.type === "income") {
      stats.incomes[currency] += Number(item.amount);
    }
  }

  return stats;
}
  export async function getCategoryExpenses(user_id = "default", category) {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("amount, currency")
      .eq("user_id", user_id)
      .eq("type", "expense")
      .eq("category", category);
  
    if (error) {
      console.error(error);
      return {};
    }
  
    const result = {};
  
    for (const item of data) {
      const currency = item.currency || "VND";
  
      if (!result[currency]) {
        result[currency] = 0;
      }
  
      result[currency] += Number(item.amount);
    }
  
    return result;
  }
  export async function getExpensesByPeriod(user_id = "default", days = 30) {
  const from = new Date();
  from.setDate(from.getDate() - days);

  const { data, error } = await supabase
    .from("finance_transactions")
    .select("amount, currency")
    .eq("user_id", user_id)
    .eq("type", "expense")
    .gte("created_at", from.toISOString());

  if (error) {
    console.error(error);
    return {};
  }

  const totals = {};
  const rows = Array.isArray(data) ? data : [];

  for (const item of rows) {
    const currency = item.currency || "VND";

    if (!totals[currency]) {
      totals[currency] = 0;
    }

    totals[currency] += Number(item.amount);
  }

  return totals;
}
export async function getFinanceAnalytics(user_id = "default") {

    const { data, error } = await supabase
      .from("finance_transactions")
      .select("*")
      .eq("user_id", user_id)
      .eq("type", "expense");
  
    if (error) {
      console.error(error);
      return null;
    }
  
    const categories = {};
    const currencies = {};
  
    let biggest = null;
  
    for (const item of data) {
  
      const currency = item.currency || "VND";
  
      if (!currencies[currency]) {
        currencies[currency] = 0;
      }
  
      currencies[currency] += Number(item.amount);
  
      const category = item.category || "Другое";
  
      if (!categories[category]) {
        categories[category] = {};
      }
  
      if (!categories[category][currency]) {
        categories[category][currency] = 0;
      }
  
      categories[category][currency] += Number(item.amount);
  
      if (
        !biggest ||
        Number(item.amount) > Number(biggest.amount)
      ) {
        biggest = item;
      }
  
    }
  
    return {
      categories,
      currencies,
      biggest
    };
  
  }
  export async function deleteLastTransaction(user_id = "default") {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
  
    if (error || !data) {
      return null;
    }
    console.log("LAST TRANSACTION:", data);
    // Если есть batch_id — удаляем всю группу
    if (data.batch_id && data.batch_id !== "NULL") {
            console.log("DELETE BATCH:", data.batch_id);
            const { data: batch } = await supabase
  .from("finance_transactions")
  .select("*")
  .eq("batch_id", data.batch_id);
      const { error: deleteError } = await supabase
        .from("finance_transactions")
        .delete()
        .eq("batch_id", data.batch_id);
  
      if (deleteError) {
        console.error(deleteError);
        return null;
      }


  console.log("BATCH DELETED");
  
  return batch;
    }
  
    // Иначе удаляем только одну запись
    const { error: deleteError } = await supabase
      .from("finance_transactions")
      .delete()
      .eq("id", data.id);
  
    if (deleteError) {
      console.error(deleteError);
      return null;
    }
  
    return data;
  }