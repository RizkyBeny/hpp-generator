"use client";

import React, { useState, useEffect } from 'react';
import IngredientManager, { Ingredient } from "@/components/ingredients/IngredientManager";
import RecipeForm from "@/components/recipes/RecipeForm";
import RecipeList from "@/components/recipes/RecipeList";
import RecipeDetail from "@/components/recipes/RecipeDetail";
import {
    LucidePlus,
    LucideChefHat,
    LucidePackage,
    LucideLayoutDashboard,
    LucideArrowRight,
    LucideSearch,
    LucideUser,
    LucideBell,
    LucideCalendar,
    LucideSettings,
    LucideLogOut,
    LucideMenu,
    LucideX
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function Home() {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [authEmail, setAuthEmail] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [authError, setAuthError] = useState<string | null>(null);
    const [isAuthLoading, setIsAuthLoading] = useState(false);

    const [activeTab, setActiveTab] = useState<'dashboard' | 'ingredients' | 'recipes' | 'recipe-detail'>('dashboard');
    const [ingredients, setIngredients] = useState<Ingredient[]>([]);
    const [recipeCount, setRecipeCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const switchTab = (tab: typeof activeTab) => {
        setActiveTab(tab);
        setMobileMenuOpen(false);
    };
    const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

    const handleViewRecipe = (recipeId: string) => {
        setSelectedRecipeId(recipeId);
        setActiveTab('recipe-detail');
    };

    const handleBackFromDetail = () => {
        setSelectedRecipeId(null);
        setActiveTab('dashboard');
    };

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setIsAuthenticated(true);
            } else {
                setIsAuthenticated(false);
            }
        };
        checkAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsAuthenticated(!!session);
            if (session) setIsDemoMode(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    // Fetch data when authenticated (real or demo)
    useEffect(() => {
        const fetchData = async () => {
            if (!isAuthenticated && !isDemoMode) return;
            setIsLoading(true);

            try {
                // ... same fetch logic
                const { data, error } = await supabase
                    .from('ingredients')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (error) {
                    // In demo mode, we might get RLS errors if not logged in.
                    // We can either ignore them or show mock data.
                    // For now, let's just not crash.
                    console.log('Database fetch ignored or failed (Demo mode?):', error.message);
                }

                if (data) {
                    const mappedData: Ingredient[] = data.map(item => ({
                        id: item.id,
                        name: item.name,
                        buyPrice: Number(item.buy_price),
                        buyQuantity: Number(item.buy_quantity),
                        buyUnit: item.buy_unit,
                        weightPerUnit: Number(item.weight_per_unit)
                    }));
                    setIngredients(mappedData);
                }

                const { count, error: recipeError } = await supabase
                    .from('recipes')
                    .select('*', { count: 'exact', head: true });
                if (!recipeError && count !== null) {
                    setRecipeCount(count);
                }
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        if (isAuthenticated || isDemoMode) {
            fetchData();
        }
    }, [isAuthenticated, isDemoMode]);

    const handleIngredientsChange = (newIngs: Ingredient[]) => {
        setIngredients(newIngs);
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError(null);
        setIsAuthLoading(true);
        try {
            if (authMode === 'login') {
                const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
                if (error) throw error;
                // If sign up succeeds but requires email confirmation, checking session might still be null depending on Supabase settings.
                // Assuming standard auto-login or requiring simple email for now.
                alert('Pendaftaran berhasil! Silakan masuk.');
                setAuthMode('login');
                setAuthPassword('');
            }
        } catch (error: any) {
            setAuthError(error.message || 'Gagal masuk. Periksa kembali email dan password Anda.');
        } finally {
            setIsAuthLoading(false);
        }
    };

    const handleDemoBypass = () => {
        setIsDemoMode(true);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setIsAuthenticated(false);
        setIsDemoMode(false);
    };

    const isUserLoggedIn = isAuthenticated || isDemoMode;

    if (isAuthenticated === null) {
        return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" />; // Empty state while checking session
    }

    if (!isUserLoggedIn) {
        return (
            <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 items-center justify-center p-4">
                <div className="w-full max-w-sm rounded-2xl border bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-500">
                    <div className="p-8 space-y-6">
                        <div className="flex flex-col items-center justify-center space-y-2 text-center">
                            <div className="h-12 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-2">
                                <LucideChefHat className="h-6 w-6 text-zinc-900 dark:text-zinc-50" />
                            </div>
                            <h1 className="text-2xl font-bold tracking-tight">HargaKu App</h1>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                {authMode === 'login' ? 'Masuk kembali ke akun Anda.' : 'Buat akun untuk memulai.'}
                            </p>
                        </div>

                        {authError && (
                            <div className="bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 p-3 rounded-md text-xs border border-red-200 dark:border-red-900">
                                {authError}
                            </div>
                        )}

                        <form onSubmit={handleAuth} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={authEmail}
                                    onChange={(e) => setAuthEmail(e.target.value)}
                                    placeholder="demo@hargaku.com"
                                    className="flex h-10 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium">Password</label>
                                    {authMode === 'login' && (
                                        <a href="#" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">Lupa password?</a>
                                    )}
                                </div>
                                <input
                                    type="password"
                                    required
                                    value={authPassword}
                                    onChange={(e) => setAuthPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="flex h-10 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isAuthLoading}
                                className="inline-flex w-full h-10 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-50 dark:text-zinc-900 shadow hover:bg-zinc-900/90 dark:hover:bg-zinc-50/90 transition-colors disabled:opacity-50"
                            >
                                {isAuthLoading ? 'Memproses...' : (authMode === 'login' ? 'Masuk' : 'Daftar Akun')}
                            </button>
                        </form>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-zinc-200 dark:border-zinc-800" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white dark:bg-zinc-900 px-2 text-zinc-500">atau</span>
                            </div>
                        </div>

                        <button
                            onClick={handleDemoBypass}
                            className="inline-flex w-full h-10 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                            Masuk secara Instan (Akun Demo)
                        </button>

                        <div className="text-center text-sm">
                            <span className="text-zinc-500">
                                {authMode === 'login' ? 'Belum punya akun? ' : 'Sudah punya akun? '}
                            </span>
                            <button
                                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                                className="font-medium underline hover:text-zinc-700 dark:hover:text-zinc-300"
                            >
                                {authMode === 'login' ? 'Daftar sekarang' : 'Masuk di sini'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-background font-sans antialiased text-foreground">
            {/* Mobile Sidebar Overlay */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
                    <aside className="absolute left-0 top-0 h-full w-72 bg-white dark:bg-zinc-950 border-r shadow-xl flex flex-col animate-in slide-in-from-left duration-200">
                        <div className="flex h-14 items-center justify-between border-b px-6">
                            <div className="flex items-center gap-2 font-semibold">
                                <LucideChefHat className="h-6 w-6" />
                                <span>HargaKu</span>
                            </div>
                            <button onClick={() => setMobileMenuOpen(false)} className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted">
                                <LucideX className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
                            <p className="px-3 mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">General</p>
                            <button onClick={() => switchTab('dashboard')} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900'}`}>
                                <LucideLayoutDashboard className="h-4 w-4" /> Dashboard
                            </button>
                            <button onClick={() => switchTab('ingredients')} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeTab === 'ingredients' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900'}`}>
                                <LucidePackage className="h-4 w-4" /> Inventaris
                            </button>
                            <button onClick={() => switchTab('recipes')} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${activeTab === 'recipes' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900'}`}>
                                <LucidePlus className="h-4 w-4" /> Kalkulasi Baru
                            </button>
                            <p className="px-3 mb-2 mt-6 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">System</p>
                            <button className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 transition-colors">
                                <LucideSettings className="h-4 w-4" /> Settings
                            </button>
                        </div>
                        <div className="p-4 border-t">
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-3 p-2 rounded-md">
                                    <div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-500">
                                        <LucideUser className="h-5 w-5" />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-medium truncate leading-none">Admin Demo</span>
                                        <span className="text-[10px] text-zinc-400 truncate mt-1">demo@hargaku.com</span>
                                    </div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                >
                                    <LucideLogOut className="h-4 w-4" /> Keluar
                                </button>
                            </div>
                        </div>
                    </aside>
                </div>
            )}

            {/* Desktop Sidebar */}
            <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r bg-muted/40 lg:flex flex-col z-40">
                <div className="flex h-14 items-center border-b px-6">
                    <div className="flex items-center gap-2 font-semibold">
                        <LucideChefHat className="h-6 w-6" />
                        <span>HargaKu</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
                    <p className="px-3 mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">General</p>
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900'}`}
                    >
                        <LucideLayoutDashboard className="h-4 w-4" />
                        Dashboard
                    </button>
                    <button
                        onClick={() => setActiveTab('ingredients')}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'ingredients' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900'}`}
                    >
                        <LucidePackage className="h-4 w-4" />
                        Inventaris
                    </button>
                    <button
                        onClick={() => setActiveTab('recipes')}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'recipes' ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50 shadow-sm' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900'}`}
                    >
                        <LucidePlus className="h-4 w-4" />
                        Kalkulasi Baru
                    </button>

                    <p className="px-3 mb-2 mt-6 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">System</p>
                    <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 transition-colors">
                        <LucideSettings className="h-4 w-4" />
                        Settings
                    </button>
                </div>

                <div className="mt-auto p-4 border-t">
                    <div
                        onClick={handleLogout}
                        className="flex items-center gap-3 p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                    >
                        <div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-500">
                            <LucideUser className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium truncate leading-none">Admin Demo</span>
                            <span className="text-[10px] text-zinc-400 truncate mt-1">demo@hargaku.com</span>
                        </div>
                        <LucideLogOut className="h-3 w-3 ml-auto text-zinc-400" />
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 lg:ml-64 flex flex-col min-h-screen relative bg-background">
                {/* Header - Precise Shadcn h-14 */}
                <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-8">
                    <div className="flex items-center gap-2 text-sm font-medium overflow-hidden">
                        <button
                            onClick={() => setMobileMenuOpen(true)}
                            className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted transition-colors lg:hidden mr-1"
                        >
                            <LucideMenu className="h-5 w-5" />
                        </button>
                        <span className="text-muted-foreground whitespace-nowrap hidden sm:inline">HargaKu</span>
                        <span className="text-muted-foreground hidden sm:inline">/</span>
                        <span className="capitalize truncate">{activeTab === 'recipe-detail' ? 'Detail Resep' : activeTab}</span>
                    </div>

                    <div className="flex items-center gap-2 md:gap-4">
                        <div className="relative hidden sm:flex items-center">
                            <LucideSearch className="absolute left-2.5 h-4 w-4 text-muted-foreground" />
                            <input
                                type="search"
                                placeholder="Search..."
                                className="h-9 w-40 lg:w-64 rounded-md border border-input bg-background pl-8 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                        <button className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                            <LucideBell className="h-4 w-4" />
                        </button>
                    </div>
                </header>

                <div className="p-4 md:p-8 pt-6 pb-20 lg:pb-8 space-y-6 w-full">
                    {activeTab === 'dashboard' && (
                        <div className="space-y-6 animate-in fade-in duration-500">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h2>
                                <div className="flex items-center space-x-2">
                                    <button className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white shadow hover:bg-zinc-800 transition-colors dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200">
                                        <LucideCalendar className="mr-2 h-4 w-4" />
                                        <span className="hidden sm:inline">Jan 20, 2026 - Feb 28, 2026</span>
                                        <span className="sm:hidden">Jan - Feb 2026</span>
                                    </button>
                                </div>
                            </div>

                            {/* Dashboard Metrics and Actions */}
                            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                                <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                                    <div className="p-4 md:p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                                        <h3 className="tracking-tight text-sm md:text-sm font-medium">Bahan Baku</h3>
                                        <LucidePackage className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="px-4 pb-4 md:p-6 pt-0">
                                        <div className="text-xl md:text-2xl font-bold">{ingredients.length}</div>
                                        <p className="text-xs md:text-xs text-muted-foreground mt-0.5">Tersimpan di gudang</p>
                                    </div>
                                </div>
                                <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                                    <div className="p-4 md:p-6 flex flex-row items-center justify-between space-y-0 pb-2">
                                        <h3 className="tracking-tight text-sm md:text-sm font-medium">Total Resep</h3>
                                        <LucideChefHat className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="px-4 pb-4 md:p-6 pt-0">
                                        <div className="text-xl md:text-2xl font-bold">{recipeCount}</div>
                                        <p className="text-xs md:text-xs text-muted-foreground mt-0.5">Telah dikalkulasi</p>
                                    </div>
                                </div>
                                <div className="col-span-2 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden relative group">
                                    <div className="flex flex-row h-full">
                                        {/* Illustration Left */}
                                        <div className="hidden sm:flex w-1/3 bg-zinc-100 dark:bg-zinc-900 items-center justify-center border-r relative overflow-hidden">
                                            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-400 via-transparent to-transparent"></div>
                                            <LucidePackage className="h-16 w-16 text-zinc-300 dark:text-zinc-700 transition-transform duration-500 group-hover:scale-110" strokeWidth={1.5} />
                                        </div>

                                        {/* Content Right */}
                                        <div className="flex flex-col justify-center p-6 gap-6 flex-1">
                                            <div className="space-y-2">
                                                <h3 className="text-base font-bold leading-none tracking-tight">Inventaris Cepat</h3>
                                                <p className="text-sm text-muted-foreground w-full">Perbarui harga beli dari bahan baku Anda agar perhitungan margin dan HPP pada katalog selalu akurat setiap saat.</p>
                                            </div>
                                            <button
                                                onClick={() => setActiveTab('ingredients')}
                                                className="w-fit h-9 rounded-md bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 text-xs font-semibold px-5 shadow transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                                            >
                                                Manage Gudang <LucideArrowRight className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
                                <div className="flex flex-col space-y-1.5 p-5 md:p-6 pb-2 md:pb-4">
                                    <h3 className="text-base font-semibold leading-none tracking-tight">Katalog HPP Produk</h3>
                                    <p className="text-sm text-muted-foreground">Daftar resep yang telah dikalkulasi. Klik untuk melihat detail.</p>
                                </div>
                                <div className="overflow-x-auto">
                                    <RecipeList onViewRecipe={handleViewRecipe} />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'ingredients' && (
                        <div className="animate-in fade-in duration-500">
                            <IngredientManager onIngredientsChange={handleIngredientsChange} initialIngredients={ingredients} />
                        </div>
                    )}

                    {activeTab === 'recipes' && (
                        <div className="animate-in fade-in duration-500">
                            <RecipeForm availableIngredients={ingredients} />
                        </div>
                    )}

                    {activeTab === 'recipe-detail' && selectedRecipeId && (
                        <RecipeDetail recipeId={selectedRecipeId} onBack={handleBackFromDetail} availableIngredients={ingredients} />
                    )}
                </div>

                {/* Mobile Bottom Navigation */}
                <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around h-16 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden">
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${activeTab === 'dashboard' ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400'}`}
                    >
                        <LucideLayoutDashboard className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Dashboard</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('ingredients')}
                        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${activeTab === 'ingredients' ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400'}`}
                    >
                        <LucidePackage className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Inventaris</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('recipes')}
                        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${activeTab === 'recipes' ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-400'}`}
                    >
                        <LucidePlus className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Kalkulasi</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors text-zinc-400`}
                    >
                        <LucideSettings className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Settings</span>
                    </button>
                </nav>
            </main>

            {/* Spacer for mobile bottom nav */}
            <div className="h-16 lg:hidden" />
        </div>
    );
}
