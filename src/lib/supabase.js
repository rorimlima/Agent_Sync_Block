import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sojrshfcnfserxbdlrjc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvanJzaGZjbmZzZXJ4YmRscmpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTYwMTUsImV4cCI6MjA5MjUzMjAxNX0.Vtf4J1mJDao6I9uT6Ea9P_UlAD8-vrEysiHXy2XMG1g';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
