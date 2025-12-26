/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedImage, ComplexityLevel, VisualStyle, Language, SearchResultItem, AspectRatio, ImageResolution } from './types';
import { 
  researchTopicForPrompt, 
  generateInfographicImage, 
  editInfographicImage,
} from './services/geminiService';
import { uploadToGCS } from './services/storageService';
import Infographic from './components/Infographic';
import Loading from './components/Loading';
import SearchResults from './components/SearchResults';
import { Search, AlertCircle, History, GraduationCap, Palette, Atom, Compass, Globe, Sun, Moon, Key, CreditCard, ExternalLink, DollarSign, FileText, X, Plus, Upload, Link, LayoutTemplate, Zap, Rocket, PlusCircle, Trash2 } from 'lucide-react';

interface ContextSource {
  id: string;
  type: 'file' | 'url';
  name: string;
  content: string;
}

const STORAGE_KEY = 'infogenius_history_v1';

const App: React.FC = () => {
  const [topic, setTopic] = useState('');
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  
  const [complexityLevel, setComplexityLevel] = useState<ComplexityLevel>('Expert');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('Default');
  const [language, setLanguage] = useState<Language>('English');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingStep, setLoadingStep] = useState<number>(0);
  const [loadingFacts, setLoadingFacts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const [imageHistory, setImageHistory] = useState<GeneratedImage[]>([]);
  const [currentSearchResults, setCurrentSearchResults] = useState<SearchResultItem[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Context Source State (Array of Files or URLs)
  const [contextSources, setContextSources] = useState<ContextSource[]>([]);
  const [showContextOptions, setShowContextOptions] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // API Key State
  const [hasApiKey, setHasApiKey] = useState(false);
  const [checkingKey, setCheckingKey] = useState(true);

  // Persistence: Load History
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setImageHistory(parsed);
        if (parsed.length > 0) {
          setActiveImageId(parsed[0].id);
        }
      } catch (e) {
        console.error("Failed to parse saved history", e);
      }
    }
  }, []);

  // Persistence: Save History
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imageHistory));
  }, [imageHistory]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Check for API Key on Mount
  useEffect(() => {
    const checkKey = async () => {
      try {
        if (window.aistudio && window.aistudio.hasSelectedApiKey) {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } else {
          setHasApiKey(true);
        }
      } catch (e) {
        console.error("Error checking API key:", e);
      } finally {
        setCheckingKey(false);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
        setError(null);
      } catch (e) {
        console.error("Failed to open key selector:", e);
      }
    }
  };

  const handleNewSession = () => {
    setTopic('');
    setContextSources([]);
    setActiveImageId(null);
    setCurrentSearchResults([]);
    setError(null);
    setLoadingFacts([]);
    setLoadingStep(0);
    setLoadingMessage('');
  };

  const handleClearHistory = () => {
    if (window.confirm("Clear all session archives? This cannot be undone.")) {
      setImageHistory([]);
      setActiveImageId(null);
      setCurrentSearchResults([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files) as File[];

    for (const file of fileArray) {
        if (file.size > 1024 * 1024) {
            setError(`File "${file.name}" is too large. Please upload files smaller than 1MB.`);
            e.target.value = ''; 
            return;
        }
    }
    
    fileArray.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          setContextSources(prev => [...prev, { 
              id: Math.random().toString(36).substr(2, 9),
              type: 'file', 
              name: file.name, 
              content 
          }]);
        };
        reader.readAsText(file);
    });

    setError(null);
    setShowContextOptions(false);
    e.target.value = ''; 
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInputValue.trim()) return;
    
    setContextSources(prev => [...prev, { 
        id: Math.random().toString(36).substr(2, 9),
        type: 'url', 
        name: urlInputValue, 
        content: urlInputValue 
    }]);

    setUrlInputValue('');
    setShowUrlInput(false);
    setShowContextOptions(false);
    setError(null);
  };

  const removeContextSource = (id: string) => {
      setContextSources(prev => prev.filter(source => source.id !== id));
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!topic.trim() && contextSources.length === 0) {
        setError("Please enter a topic or provide context (File/URL) to visualize.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setLoadingStep(1);
    setLoadingFacts([]);
    setCurrentSearchResults([]);
    setLoadingMessage(`Researching...`);

    let contextData = null;
    if (contextSources.length > 0) {
        contextData = contextSources.map((source, index) => {
            if (source.type === 'file') {
                return `SOURCE ${index + 1} (File: ${source.name}):\n${source.content}`;
            } else {
                return `SOURCE ${index + 1} (URL: ${source.content}):\nPlease visit this URL to gather relevant context.`;
            }
        }).join('\n\n---\n\n');
    }

    let effectiveTopic = topic.trim();
    if (!effectiveTopic && contextSources.length > 0) {
        const sourceNames = contextSources.map(s => s.name).join(', ');
        effectiveTopic = `Create a comprehensive infographic visualizing the key concepts from the provided sources (${sourceNames}).`;
    }

    try {
      const researchResult = await researchTopicForPrompt(
          effectiveTopic, 
          complexityLevel, 
          visualStyle, 
          language,
          contextData
      );
      
      setLoadingFacts(researchResult.facts);
      setCurrentSearchResults(researchResult.searchResults);
      
      setLoadingStep(2);
      setLoadingMessage(`Designing Infographic...`);
      
      let base64Data = await generateInfographicImage(researchResult.imagePrompt, aspectRatio, resolution);
      
      const newImageId = Date.now().toString();
      const newImage: GeneratedImage = {
        id: newImageId,
        data: base64Data,
        prompt: effectiveTopic,
        timestamp: Date.now(),
        level: complexityLevel,
        style: visualStyle,
        language: language,
        aspectRatio: aspectRatio,
        resolution: resolution
      };

      setImageHistory(prev => [newImage, ...prev]);
      setActiveImageId(newImageId);
      
      // Automatic background upload to Google Cloud Storage
      uploadToGCS(base64Data, newImageId);
      
    } catch (err: any) {
      console.error(err);
      if (err.message && (err.message.includes("Requested entity was not found") || err.message.includes("404") || err.message.includes("403"))) {
          setError("Access denied. The selected API key does not have access to the required models. Please select a project with billing enabled.");
          setHasApiKey(false);
      } else {
          setError('The image generation service is temporarily unavailable. Please try again.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep(0);
    }
  };

  const handleEdit = async (editPrompt: string) => {
    if (!activeImageId) return;
    const currentImage = imageHistory.find(img => img.id === activeImageId);
    if (!currentImage) return;

    setIsLoading(true);
    setError(null);
    setLoadingStep(2);
    setLoadingMessage(`Processing Modification: "${editPrompt}"...`);

    try {
      const base64Data = await editInfographicImage(currentImage.data, editPrompt);
      const newImageId = Date.now().toString();
      const newImage: GeneratedImage = {
        id: newImageId,
        data: base64Data,
        prompt: editPrompt,
        timestamp: Date.now(),
        level: currentImage.level,
        style: currentImage.style,
        language: currentImage.language,
        aspectRatio: currentImage.aspectRatio,
        resolution: currentImage.resolution
      };
      setImageHistory(prev => [newImage, ...prev]);
      setActiveImageId(newImageId);
      
      // Automatic background upload to Google Cloud Storage for edited versions
      uploadToGCS(base64Data, newImageId);
      
    } catch (err: any) {
      console.error(err);
      if (err.message && (err.message.includes("Requested entity was not found") || err.message.includes("404") || err.message.includes("403"))) {
          setError("Access denied. Please select a valid API key with billing enabled.");
          setHasApiKey(false);
      } else {
          setError('Modification failed. Try a different command.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep(0);
    }
  };

  const activeImage = imageHistory.find(img => img.id === activeImageId);

  return (
    <>
    {!checkingKey && !hasApiKey && <KeySelectionModal />}
    {showUrlInput && <UrlInputModal />}

    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans selection:bg-cyan-500 selection:text-white pb-20 relative overflow-x-hidden animate-in fade-in duration-1000 transition-colors">
      
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-white dark:from-indigo-900 dark:via-slate-950 dark:to-black z-0 transition-colors"></div>
      <div className="fixed inset-0 opacity-5 dark:opacity-20 z-0 pointer-events-none" style={{
          backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
      }}></div>

      <header className="border-b border-slate-200 dark:border-white/10 sticky top-0 z-50 backdrop-blur-md bg-white/70 dark:bg-slate-950/60 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4 group cursor-pointer" onClick={handleNewSession}>
            <div className="relative scale-90 md:scale-100">
                <div className="absolute inset-0 bg-cyan-500 blur-lg opacity-20 dark:opacity-40 group-hover:opacity-60 transition-opacity"></div>
                <div className="bg-white dark:bg-gradient-to-br dark:from-slate-900 dark:to-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-white/10 relative z-10 shadow-sm dark:shadow-none">
                   <Atom className="w-6 h-6 text-cyan-600 dark:text-cyan-400 animate-[spin_10s_linear_infinite]" />
                </div>
            </div>
            <div className="flex flex-col">
                <span className="font-display font-bold text-lg md:text-2xl tracking-tight text-slate-900 dark:text-white leading-none">
                InfoGenius <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-indigo-600 dark:from-cyan-400 dark:to-amber-400">Vision</span>
                </span>
                <span className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 font-medium">Visual Knowledge Engine</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
              <button 
                onClick={handleNewSession}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors shadow-sm shadow-cyan-500/20 mr-2"
                title="Start New Session"
              >
                <PlusCircle className="w-4 h-4" />
                <span className="hidden md:inline">New Session</span>
              </button>

              <button 
                onClick={handleSelectKey}
                className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-cyan-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-medium transition-colors border border-slate-200 dark:border-white/10"
                title="Change API Key"
              >
                <Key className="w-3.5 h-3.5" />
                <span>API Key</span>
              </button>

              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors border border-slate-200 dark:border-white/10 shadow-sm"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-6 py-4 md:py-8 relative z-10">
        
        <div className={`max-w-6xl mx-auto transition-all duration-500 ${activeImageId ? 'mb-4 md:mb-8' : 'min-h-[50vh] md:min-h-[70vh] flex flex-col justify-center'}`}>
          
          {!activeImageId && (
            <div className="text-center mb-6 md:mb-16 space-y-3 md:space-y-8 animate-in slide-in-from-bottom-8 duration-700 fade-in">
              <div className="inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-amber-600 dark:text-amber-300 text-[10px] md:text-xs font-bold tracking-widest uppercase shadow-sm dark:shadow-[0_0_20px_rgba(251,191,36,0.1)] backdrop-blur-sm">
                <Compass className="w-3 h-3 md:w-4 md:h-4" /> Explore vast subjects like history, science, and more.
              </div>
              <h1 className="text-3xl sm:text-5xl md:text-8xl font-display font-bold text-slate-900 dark:text-white tracking-tight leading-[0.95] md:leading-[0.9]">
                Visualize <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 dark:from-cyan-400 dark:via-indigo-400 dark:to-purple-400">The Unknown.</span>
              </h1>
              <p className="text-sm md:text-2xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto font-light leading-relaxed px-4">
                Generate diagrams and infographics powered by Gemini & grounded with Google search.
              </p>
            </div>
          )}

          <form onSubmit={handleGenerate} className={`relative z-20 transition-all duration-300 ${isLoading ? 'opacity-50 pointer-events-none scale-95 blur-sm' : 'scale-100'}`}>
            <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-amber-500 rounded-3xl opacity-10 dark:opacity-20 group-hover:opacity-30 dark:group-hover:opacity-40 transition duration-500 blur-xl"></div>
                <div className="relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200 dark:border-white/10 p-2 rounded-3xl shadow-2xl">
                    <div className="relative flex items-center">
                        <Search className="absolute left-4 md:left-6 w-5 h-5 md:w-6 md:h-6 text-slate-400 group-focus-within:text-cyan-500 transition-colors" />
                        <input
                            type="text"
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder={contextSources.length > 0 ? "Describe specific focus (optional)..." : "What do you want to visualize?"}
                            className="w-full pl-12 md:pl-16 pr-12 md:pr-14 py-3 md:py-6 bg-transparent border-none outline-none text-base md:text-2xl placeholder:text-slate-400 font-medium text-slate-900 dark:text-white"
                        />
                        <div className="absolute right-3 md:right-4 flex items-center">
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowContextOptions(!showContextOptions)}
                                    className={`p-2 transition-all duration-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 ${showContextOptions ? 'bg-slate-100 dark:bg-slate-800 text-cyan-600' : 'text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400'}`}
                                    title="Add Context"
                                >
                                    <Plus className={`w-5 h-5 transition-transform duration-200 ${showContextOptions ? 'rotate-45' : ''}`} />
                                </button>
                                {showContextOptions && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowContextOptions(false)}></div>
                                        <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-white/10 overflow-hidden z-20 animate-in slide-in-from-top-2 fade-in duration-200">
                                            <button
                                                type="button"
                                                onClick={() => fileInputRef.current?.click()}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-bold text-slate-700 dark:text-slate-200"
                                            >
                                                <Upload className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                                                Upload File
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setShowUrlInput(true); setShowContextOptions(false); }}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-bold text-slate-700 dark:text-slate-200 border-t border-slate-100 dark:border-white/5"
                                            >
                                                <Link className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                                Add Link
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".md,.txt,.markdown" className="hidden" multiple />
                        </div>
                    </div>

                    {contextSources.length > 0 && (
                        <div className="px-4 pb-2 flex flex-wrap gap-2 max-h-[100px] overflow-y-auto">
                            {contextSources.map((source) => (
                                <div key={source.id} className="inline-flex items-center gap-2 bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 px-3 py-1.5 rounded-lg text-xs font-bold border border-cyan-200 dark:border-cyan-700/50 shadow-sm max-w-full">
                                    {source.type === 'file' ? <FileText className="w-3.5 h-3.5 flex-shrink-0" /> : <Link className="w-3.5 h-3.5 flex-shrink-0" />}
                                    <span className="truncate max-w-[150px]">{source.name}</span>
                                    <button type="button" onClick={() => removeContextSource(source.id)} className="ml-1 p-0.5 hover:bg-cyan-200 dark:hover:bg-cyan-800 rounded-full transition-colors"><X className="w-3.5 h-3.5" /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row gap-2 p-2 mt-1 border-t border-slate-200 dark:border-white/5 pt-3">
                    <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 relative overflow-hidden">
                        <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-cyan-600 dark:text-cyan-400 shrink-0 shadow-sm"><GraduationCap className="w-4 h-4" /></div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Audience</label>
                            <select value={complexityLevel} onChange={(e) => setComplexityLevel(e.target.value as ComplexityLevel)} className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full truncate pr-4">
                                <option value="Elementary">Elementary</option>
                                <option value="High School">High School</option>
                                <option value="College">College</option>
                                <option value="Expert">Expert</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 relative overflow-hidden">
                         <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-purple-600 dark:text-purple-400 shrink-0 shadow-sm"><Palette className="w-4 h-4" /></div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Aesthetic</label>
                            <select value={visualStyle} onChange={(e) => setVisualStyle(e.target.value as VisualStyle)} className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full truncate pr-4">
                                <option value="Default">Standard Scientific</option>
                                <option value="Minimalist">Minimalist</option>
                                <option value="Realistic">Photorealistic</option>
                                <option value="Cartoon">Graphic Novel</option>
                                <option value="Vintage">Vintage Lithograph</option>
                                <option value="Futuristic">Cyberpunk HUD</option>
                                <option value="3D Render">3D Isometric</option>
                                <option value="Sketch">Technical Blueprint</option>
                            </select>
                        </div>
                    </div>
                     <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 relative overflow-hidden">
                         <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-green-600 dark:text-green-400 shrink-0 shadow-sm"><Globe className="w-4 h-4" /></div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Language</label>
                            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full truncate pr-4">
                                <option value="English">English</option>
                                <option value="Spanish">Spanish</option>
                                <option value="French">French</option>
                                <option value="German">German</option>
                                <option value="Mandarin">Mandarin</option>
                                <option value="Japanese">Japanese</option>
                                <option value="Hindi">Hindi</option>
                                <option value="Arabic">Arabic</option>
                                <option value="Portuguese">Portuguese</option>
                                <option value="Russian">Russian</option>
                            </select>
                        </div>
                    </div>
                     <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 relative overflow-hidden">
                         <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-pink-600 dark:text-pink-400 shrink-0 shadow-sm"><LayoutTemplate className="w-4 h-4" /></div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Format</label>
                            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as AspectRatio)} className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full truncate pr-4">
                                <option value="1:1">Square (1:1)</option>
                                <option value="16:9">Widescreen (16:9)</option>
                                <option value="9:16">Mobile (9:16)</option>
                                <option value="4:3">Standard (4:3)</option>
                                <option value="3:4">Portrait (3:4)</option>
                                <option value="3:2">Landscape (3:2)</option>
                                <option value="2:3">Tall (2:3)</option>
                                <option value="21:9">Cinema (21:9)</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 relative overflow-hidden">
                         <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-amber-600 dark:text-amber-400 shrink-0 shadow-sm"><Zap className="w-4 h-4" /></div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Quality</label>
                            <select value={resolution} onChange={(e) => setResolution(e.target.value as ImageResolution)} className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full truncate pr-4">
                                <option value="1K">1K (Fast)</option>
                                <option value="2K">2K (High)</option>
                                <option value="4K">4K (Ultra)</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1 w-full md:w-auto">
                        <button type="submit" disabled={isLoading} className="w-full md:w-auto h-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-8 py-4 rounded-2xl font-bold font-display tracking-wide hover:brightness-110 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] whitespace-nowrap flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Rocket className="w-5 h-5" />
                            <span>INITIATE</span>
                        </button>
                    </div>
                    </div>
                </div>
            </div>
          </form>
        </div>

        {isLoading && <Loading status={loadingMessage} step={loadingStep} facts={loadingFacts} />}

        {error && (
          <div className="max-w-2xl mx-auto mt-8 p-6 bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl flex items-center gap-4 text-red-800 dark:text-red-200 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 shadow-sm">
            <AlertCircle className="w-6 h-6 flex-shrink-0 text-red-500 dark:text-red-400" />
            <div className="flex-1">
                <p className="font-medium">{error}</p>
                {(error.includes("Access denied") || error.includes("billing")) && (
                    <button onClick={handleSelectKey} className="mt-2 text-xs font-bold text-red-700 dark:text-red-300 underline">Select a different API key</button>
                )}
            </div>
          </div>
        )}

        {activeImage && !isLoading && (
            <>
                <Infographic image={activeImage} onEdit={handleEdit} isEditing={isLoading} />
                <SearchResults results={currentSearchResults} />
            </>
        )}

        {imageHistory.length > 0 && (
            <div className="max-w-7xl mx-auto mt-16 md:mt-24 border-t border-slate-200 dark:border-white/10 pt-12 transition-colors">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] flex items-center gap-3">
                      <History className="w-4 h-4" />
                      Session Archives
                  </h3>
                  <button 
                    onClick={handleClearHistory}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all text-[10px] font-bold uppercase tracking-widest border border-transparent hover:border-red-500/20"
                    title="Clear All Archives"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                </div>
                
                {imageHistory.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl opacity-50">
                    <p className="text-sm text-slate-500">No archived visuals yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-6">
                      {imageHistory.map((img) => (
                          <div 
                              key={img.id} 
                              onClick={() => { setActiveImageId(img.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                              className={`group relative cursor-pointer rounded-2xl overflow-hidden border transition-all shadow-lg bg-white dark:bg-slate-900/50 backdrop-blur-sm ${img.id === activeImageId ? 'border-cyan-500 ring-2 ring-cyan-500/20 scale-[1.02]' : 'border-slate-200 dark:border-white/10 hover:border-cyan-500/50'}`}
                          >
                              <img src={img.data} alt={img.prompt} className="w-full aspect-video object-cover opacity-90 dark:opacity-70 group-hover:opacity-100 transition-opacity duration-500" />
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-8 translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                                  <p className="text-xs text-white font-bold truncate mb-1 font-display">{img.prompt}</p>
                                  <div className="flex gap-2">
                                      {img.level && <span className="text-[9px] text-cyan-100 uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-cyan-900/60 border border-cyan-500/20">{img.level}</span>}
                                      {img.resolution && <span className="text-[9px] text-amber-100 uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-amber-900/60 border border-amber-500/20">{img.resolution}</span>}
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
                )}
            </div>
        )}
      </main>
    </div>
    </>
  );
};

const KeySelectionModal = () => (
    <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border-2 border-amber-500/50 rounded-2xl shadow-2xl max-w-md w-full p-6 md:p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500"></div>
            <div className="flex flex-col items-center text-center space-y-6">
                <div className="relative">
                    <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400 mb-2 border-4 border-white dark:border-slate-900 shadow-lg">
                        <CreditCard className="w-8 h-8" />
                    </div>
                </div>
                <div className="space-y-3">
                    <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-white">Paid API Key Required</h2>
                    <p className="text-slate-600 dark:text-slate-300 text-sm">This app uses premium Gemini models. Standard API keys will fail.</p>
                </div>
                <button onClick={() => window.aistudio.openSelectKey()} className="w-full py-3.5 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl font-bold">Select Paid API Key</button>
            </div>
        </div>
    </div>
);

const UrlInputModal = () => (
    <div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
        <form className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 relative overflow-hidden z-10">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Link className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                Add Link Context
            </h3>
            <div className="space-y-4">
                <input type="url" placeholder="https://example.com" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3" />
                <div className="flex gap-3">
                    <button type="button" className="flex-1 px-4 py-2.5 rounded-xl text-slate-600 font-bold">Cancel</button>
                    <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-cyan-600 text-white font-bold">Add Link</button>
                </div>
            </div>
        </form>
    </div>
);

export default App;