import React, { useState, useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import LeftSchemaPanel from './components/LeftSchemaPanel';
import QueryModeBar from './components/QueryModeBar';
import VisualBuilder from './components/VisualBuilder';
import SqlEditor from './components/SqlEditor';
import ResultsPanel from './components/ResultsPanel';
import AISidebar from './components/AISidebar';
import { buildSqlFromConfig, parseSqlToConfig } from './utils/sqlBuilder';
import { 
  Menu, X, Bot, HelpCircle, Database, ArrowRight, 
  UserPlus, CheckCircle, LogOut, Lock, User, Server 
} from 'lucide-react';
import { runTour } from './tourSteps';

const BACKEND_URL = 'http://localhost:3002';

const initialConfig = {
    queryType: 'DQL', action: 'SELECT', selectedTable: '', selectedTableAlias: 'A',
    selectedColumns: [], joins: [], filters: [], groupBy: [], having: [],
    orderBy: { tableAlias: '', column: '', aggregation: 'NONE', direction: 'ASC' },
    limit: '', values: {}, newTableName: '', newColumns: [{ id: 1, name: '', type: 'TEXT', constraint: 'NONE' }],
    alterType: 'RENAME_TABLE', renameTo: '', addColumn: { name: '', type: 'TEXT' }, dropColumn: '',
};

function App() {
  // --- AUTH STATE ---
  const [credentials, setCredentials] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [isLoading, setIsLoading] = useState(false);

  // --- APP STATE ---
  const [schema, setSchema] = useState({ tables: [] });
  const [queryConfig, setQueryConfig] = useState(initialConfig);
  const [generatedSql, setGeneratedSql] = useState('');
  const [editedSql, setEditedSql] = useState('');
  const [isSqlModified, setIsSqlModified] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showAISidebar, setShowAISidebar] = useState(false);
  const [chartConfig, setChartConfig] = useState({ xKey: '', yKey: '' });
  const [dbType, setDbType] = useState('mysql');

  // --- LOGIN FORM (Host is Hidden) ---
  const [loginForm, setLoginForm] = useState({
      host: '136.112.86.223', // 👈 HIDDEN FROM UI, BUT SENT IN REQUEST
      user: '',
      password: '',
      database: '',
      port: 3306
  });

  // --- SIGNUP FORM ---
  const [signupForm, setSignupForm] = useState({
      projectName: '',
      password: ''
  });

  // Helper: Get Headers
  const getAuthHeaders = () => ({
      'Content-Type': 'application/json',
      'x-db-host': credentials.host,
      'x-db-user': credentials.user,
      'x-db-pass': credentials.password,
      'x-db-name': credentials.database,
      'x-db-port': credentials.port
  });

  // --- 1. CONNECT HANDLER ---
  const handleConnect = async (e) => {
      e.preventDefault();
      setIsLoading(true);
      try {
          const res = await fetch(`${BACKEND_URL}/api/schema`, {
              headers: {
                  'x-db-host': loginForm.host,
                  'x-db-user': loginForm.user,
                  'x-db-pass': loginForm.password,
                  'x-db-name': loginForm.database,
                  'x-db-port': loginForm.port
              }
          });
          if (!res.ok) throw new Error("Invalid Credentials or Database not found.");
          const data = await res.json();
          setSchema(data);
          setCredentials(loginForm);
      } catch (err) {
          alert("Connection Failed: " + err.message);
      } finally {
          setIsLoading(false);
      }
  };

  // --- 2. SIGNUP HANDLER ---
  const handleSignup = async (e) => {
      e.preventDefault();
      setIsLoading(true);
      try {
          const res = await fetch(`${BACKEND_URL}/api/create-workspace`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  newDbName: signupForm.projectName,
                  newPassword: signupForm.password
              })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

          alert(`Success! Workspace '${data.credentials.database}' created.`);
          setLoginForm({
              ...loginForm,
              user: data.credentials.user,
              password: data.credentials.password,
              database: data.credentials.database
          });
          setAuthMode('login'); 
      } catch (err) {
          alert("Creation Failed: " + err.message);
      } finally {
          setIsLoading(false);
      }
  };

  // --- 3. FETCH SCHEMA ---
  const fetchSchema = async () => {
    if (!credentials) return;
    try {
        const response = await fetch(`${BACKEND_URL}/api/schema`, { headers: getAuthHeaders() });
        const data = await response.json();
        setSchema(data);
    } catch (error) {
        console.error("Failed to fetch schema:", error);
    }
  };

  // --- 4. SQL BUILDER LOGIC ---
  useEffect(() => {
    const newSql = buildSqlFromConfig(queryConfig, dbType);
    setGeneratedSql(newSql);
    if (!isSqlModified) setEditedSql(newSql);
  }, [queryConfig, isSqlModified, dbType]);

  const handleTableSelect = (tableName) => {
    const newConf = { ...initialConfig, selectedTable: tableName, queryType: queryConfig.queryType, action: queryConfig.action };
    if (queryConfig.action === 'DROP TABLE' || queryConfig.action === 'TRUNCATE TABLE') newConf.newTableName = tableName;
    setQueryConfig(newConf);
    setChartConfig({ xKey: '', yKey: '' });
    setIsSqlModified(false);
  };
  
  const handleColumnChange = (tableName, columnName, aggregation = null) => {
    setQueryConfig(prev => {
        const newCols = [...prev.selectedColumns];
        const alias = (tableName === prev.selectedTable) ? (prev.selectedTableAlias || tableName) : (prev.joins.find(j => j.targetTable === tableName)?.alias || tableName);
        const colIndex = newCols.findIndex(c => c.name === columnName && c.table === alias);
        if (colIndex > -1) aggregation === null ? newCols.splice(colIndex, 1) : newCols[colIndex].aggregation = aggregation;
        else newCols.push({ table: alias, name: columnName, aggregation: 'NONE' });
        return { ...prev, selectedColumns: newCols };
    });
    setChartConfig({ xKey: '', yKey: '' });
    setIsSqlModified(false);
  };
  
  const handleQueryConfigChange = (newConfig) => { setQueryConfig(newConfig); setIsSqlModified(false); };
  const handleSqlChange = (newSql) => { setEditedSql(newSql); setIsSqlModified(newSql !== generatedSql); };
  const handleUseAIQuery = (sql) => { handleSqlChange(sql); setShowAISidebar(false); };

  const handleRunQuery = async () => {
    if (!credentials) return;
    if (!editedSql.trim() || editedSql.startsWith('--')) { alert("Empty query."); return; }
    setIsLoading(true);
    setQueryResult(null);
    try {
        const startTime = performance.now();
        const response = await fetch(`${BACKEND_URL}/api/query`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sql: editedSql }),
        });
        const result = await response.json();
        const endTime = performance.now();
        
        if (response.ok) {
            result.meta.runtimeMs = Math.round(endTime - startTime);
            setQueryResult(result);
        } else {
            alert(`SQL Error: ${result.error}`);
            setQueryResult({ data: [], meta: { rowsReturned: 0, runtimeMs: 0 } });
        }
    } catch (error) {
        alert("Network Error: " + error.message);
    }
    setIsLoading(false);
  };
  
  const handleParseSql = () => {
      const newConfig = parseSqlToConfig(editedSql, schema, dbType);
      if (newConfig) {
          setQueryConfig({ ...initialConfig, ...newConfig });
          setIsSqlModified(false);
          alert("Synced!");
      } else {
          alert("Parser error: Query too complex.");
      }
  };

  // ----------------------------------------------------------------
  // RENDER: LOGIN / SIGNUP SCREEN (PROFESSIONAL REDESIGN)
  // ----------------------------------------------------------------
  if (!credentials) {
      return (
          <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 font-sans p-4">
              <div className="bg-white rounded-2xl shadow-2xl flex overflow-hidden max-w-4xl w-full h-[600px]">
                  
                  {/* LEFT SIDE: BRANDING */}
                  <div className="hidden md:flex flex-col justify-center items-center w-1/2 bg-slate-100 p-12 text-center relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-full opacity-10">
                           <div className="absolute right-0 top-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl transform translate-x-10 -translate-y-10"></div>
                           <div className="absolute left-0 bottom-0 w-80 h-80 bg-indigo-500 rounded-full blur-3xl transform -translate-x-10 translate-y-10"></div>
                      </div>
                      
                      <div className="relative z-10">
                          <div className="w-20 h-20 bg-white rounded-2xl shadow-lg flex items-center justify-center mx-auto mb-8 text-blue-600">
                              <Database size={48} />
                          </div>
                          <h1 className="text-3xl font-extrabold text-slate-800 mb-4">VisualSQL Builder</h1>
                          <p className="text-slate-500 text-lg leading-relaxed">
                              Build, visualize, and optimize your database queries with our professional visual builder.
                          </p>
                      </div>
                  </div>

                  {/* RIGHT SIDE: FORMS */}
                  <div className="w-full md:w-1/2 p-12 flex flex-col relative bg-white">
                      
                      {/* AUTH TOGGLE TABS */}
                      <div className="flex p-1 bg-slate-100 rounded-lg mb-8">
                          <button 
                            onClick={() => setAuthMode('login')}
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${authMode === 'login' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                              Connect
                          </button>
                          <button 
                            onClick={() => setAuthMode('signup')}
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${authMode === 'signup' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                              Create
                          </button>
                      </div>

                      <div className="flex-1 flex flex-col justify-center">
                          {authMode === 'login' ? (
                              <form onSubmit={handleConnect} className="space-y-5">
                                  <div>
                                      <h2 className="text-2xl font-bold text-slate-800 mb-1">Welcome Back</h2>
                                      <p className="text-slate-400 text-sm">Enter your database credentials to continue.</p>
                                  </div>

                                  <div className="space-y-4">
                                      {/* DATABASE NAME */}
                                      <div>
                                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block ml-1">Database Name</label>
                                          <div className="relative">
                                              <Database className="absolute left-3 top-3 text-slate-400" size={18} />
                                              <input 
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-slate-700"
                                                placeholder="e.g. project_1"
                                                value={loginForm.database}
                                                onChange={e => setLoginForm({...loginForm, database: e.target.value})}
                                                required 
                                              />
                                          </div>
                                      </div>

                                      {/* USERNAME */}
                                      <div>
                                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block ml-1">Username</label>
                                          <div className="relative">
                                              <User className="absolute left-3 top-3 text-slate-400" size={18} />
                                              <input 
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-slate-700"
                                                placeholder="e.g. u_project_1"
                                                value={loginForm.user}
                                                onChange={e => setLoginForm({...loginForm, user: e.target.value})}
                                                required 
                                              />
                                          </div>
                                      </div>

                                      {/* PASSWORD */}
                                      <div>
                                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block ml-1">Password</label>
                                          <div className="relative">
                                              <Lock className="absolute left-3 top-3 text-slate-400" size={18} />
                                              <input 
                                                type="password" 
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-slate-700"
                                                placeholder="••••••••"
                                                value={loginForm.password}
                                                onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                                                required 
                                              />
                                          </div>
                                      </div>
                                  </div>

                                  <button disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl mt-6 flex justify-center items-center gap-2 shadow-lg hover:shadow-xl hover:shadow-blue-500/20 transition-all transform hover:-translate-y-1">
                                      {isLoading ? 'Connecting...' : <>Connect to Database <ArrowRight size={20} /></>}
                                  </button>
                              </form>
                          ) : (
                              <form onSubmit={handleSignup} className="space-y-5">
                                  <div>
                                      <h2 className="text-2xl font-bold text-slate-800 mb-1">Get Started</h2>
                                      <p className="text-slate-400 text-sm">Create a secure workspace in seconds.</p>
                                  </div>

                                  <div className="space-y-4">
                                      {/* PROJECT NAME */}
                                      <div>
                                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block ml-1">Database Name</label>
                                          <div className="relative">
                                              <Server className="absolute left-3 top-3 text-slate-400" size={18} />
                                              <input 
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-green-500 focus:ring-2 focus:ring-green-100 outline-none transition-all font-medium text-slate-700"
                                                placeholder="e.g. shop_v1"
                                                value={signupForm.projectName}
                                                onChange={e => setSignupForm({...signupForm, projectName: e.target.value})}
                                                required 
                                              />
                                          </div>
                                          <p className="text-xs text-slate-400 mt-1 ml-1">This will be your Database Name.</p>
                                      </div>

                                      {/* PASSWORD */}
                                      <div>
                                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block ml-1">Set Password</label>
                                          <div className="relative">
                                              <Lock className="absolute left-3 top-3 text-slate-400" size={18} />
                                              <input 
                                                type="password"
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-green-500 focus:ring-2 focus:ring-green-100 outline-none transition-all font-medium text-slate-700"
                                                placeholder="Create a strong password"
                                                value={signupForm.password}
                                                onChange={e => setSignupForm({...signupForm, password: e.target.value})}
                                                required 
                                              />
                                          </div>
                                      </div>
                                  </div>

                                  <button disabled={isLoading} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl mt-6 flex justify-center items-center gap-2 shadow-lg hover:shadow-xl hover:shadow-green-500/20 transition-all transform hover:-translate-y-1">
                                      {isLoading ? 'Creating...' : <>Create Workspace <CheckCircle size={20} /></>}
                                  </button>
                              </form>
                          )}
                      </div>
                      
                      <div className="mt-8 text-center text-xs text-slate-400">
                          Secure Cloud SQL Environment • MySQL Engine
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // ----------------------------------------------------------------
  // RENDER: MAIN APP (LOGGED IN)
  // ----------------------------------------------------------------
  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 font-sans">
        <header className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm z-10">
            <div className="flex items-center gap-4">
                <button onClick={() => setShowLeftPanel(!showLeftPanel)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 lg:hidden transition-colors">
                    {showLeftPanel ? <X size={20} /> : <Menu size={20} />}
                </button>
                
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-blue-200 shadow-md">
                        <Database size={16} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-slate-800 leading-tight">VisualSQL Builder</h1>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            <span className="text-xs font-medium text-slate-500">{credentials.database}</span>
                        </div>
                    </div>
                </div>
            </div>

             <div className="flex items-center gap-3">
                <QueryModeBar config={queryConfig} onConfigChange={handleQueryConfigChange} initialConfig={initialConfig} dbType={dbType} onDbTypeChange={(t) => { setDbType(t); handleTableSelect(''); }} />
                
                <div className="h-8 w-px bg-slate-200 mx-2"></div>

                <button onClick={runTour} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Start Tour">
                    <HelpCircle size={20} />
                </button>
                
                <button onClick={() => setShowAISidebar(true)} className="p-2 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="AI Assistant">
                    <Bot size={20} />
                </button>

                {/* BEAUTIFIED LOGOUT BUTTON */}
                <button 
                    onClick={() => setCredentials(null)} 
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-bold hover:bg-red-100 hover:text-red-700 transition-all border border-red-100"
                >
                    <LogOut size={16}/> 
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </div>
        </header>

        <main className="flex-grow flex overflow-hidden relative">
            <PanelGroup direction="horizontal" className="flex-1">
                {showLeftPanel && (
                    <>
                        <Panel defaultSize={20} minSize={15} maxSize={30} className="!overflow-y-auto bg-white border-r border-slate-200">
                           <div id="schema-panel" className="h-full">
                               <LeftSchemaPanel schema={schema} config={queryConfig} onTableSelect={handleTableSelect} onColumnChange={handleColumnChange} joins={queryConfig.joins} />
                           </div>
                        </Panel>
                        <PanelResizeHandle className="w-1.5 bg-slate-200 hover:bg-blue-500 transition-colors" />
                    </>
                )}
                <Panel>
                    <PanelGroup direction="vertical">
                        <Panel defaultSize={55} minSize={20} className="p-4 bg-slate-50 overflow-auto">
                            <div id="visual-builder" className="h-full">
                                <VisualBuilder schema={schema} config={queryConfig} onConfigChange={handleQueryConfigChange} dbType={dbType} />
                            </div>
                        </Panel>
                        <PanelResizeHandle className="h-1.5 bg-slate-200 hover:bg-blue-500 transition-colors" />
                        <Panel defaultSize={45} minSize={20} className="flex flex-col">
                            <div id="sql-editor" className="h-full">
                                <SqlEditor sql={editedSql} onSqlChange={handleSqlChange} isModified={isSqlModified} onSync={handleParseSql} />
                            </div>
                        </Panel>
                    </PanelGroup>
                </Panel>
                <PanelResizeHandle className="w-1.5 bg-slate-200 hover:bg-blue-500 transition-colors" />
                <Panel defaultSize={35} minSize={25}>
                    <div id="results-panel" className="h-full">
                        <ResultsPanel result={queryResult} isLoading={isLoading} onRunQuery={handleRunQuery} queryConfig={queryConfig} onConfigChange={setQueryConfig} chartConfig={chartConfig} onChartConfigChange={setChartConfig} />
                    </div>
                </Panel>
            </PanelGroup>

            {showAISidebar && (
                <AISidebar schema={schema} onUseQuery={handleUseAIQuery} onClose={() => setShowAISidebar(false)} dbType={dbType} backendUrl={BACKEND_URL} />
            )}
        </main>
    </div>
  );
}
export default App;