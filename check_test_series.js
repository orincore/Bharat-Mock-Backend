const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '/Users/orincore/Downloads/Bharat Mock WebApp/Bharat Mock Backend/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.from('test_series').select('id, title, category_id').limit(10);
  console.log("TEST SERIES:", data);
  const { data: exams, error: e2 } = await supabase.from('exams').select('id, title, test_series_id, category_id').not('test_series_id', 'is', null).limit(10);
  console.log("EXAMS with test series:", exams);
}
check();
