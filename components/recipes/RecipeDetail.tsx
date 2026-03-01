"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Ingredient, Unit } from '../ingredients/IngredientManager';
import {
    LucideArrowLeft,
    LucideUtensils,
    LucideCoffee,
    LucidePencil,
    LucideSave,
    LucidePackage,
    LucideZap,
    LucideCalendar,
    LucideTrendingUp,
    LucideTrash2,
    LucideX,
    LucideChefHat,
    LucidePlus,
    LucideDownload
} from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';
import ExportTemplate from './ExportTemplate';

interface RecipeIngredientDetail {
    id?: string;
    ingredient_id: string;
    quantity: number;
    unit: string;
    ingredients?: {
        name: string;
        buy_price: number;
        buy_quantity: number;
        buy_unit: string;
        weight_per_unit: number;
    };
}

interface RecipeOverheadDetail {
    id?: string;
    name: string;
    cost: number;
    category: string;
}

interface RecipeData {
    id: string;
    name: string;
    category: 'Makanan' | 'Minuman';
    portions: number;
    margin_percentage: number;
    created_at: string;
    total_hpp?: number;
    recipe_ingredients?: RecipeIngredientDetail[];
    recipe_overheads?: RecipeOverheadDetail[];
}

interface EditIngredientRow {
    tempId: string; // for React key
    ingredientId: string;
    quantity: number;
    unit: Unit;
}

interface RecipeDetailProps {
    recipeId: string;
    onBack: () => void;
    availableIngredients: Ingredient[];
}

export default function RecipeDetail({ recipeId, onBack, availableIngredients }: RecipeDetailProps) {
    const [recipe, setRecipe] = useState<RecipeData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editForm, setEditForm] = useState({
        name: '',
        category: 'Makanan' as 'Makanan' | 'Minuman',
        portions: 1,
        margin_percentage: 50,
    });
    const [editIngredients, setEditIngredients] = useState<EditIngredientRow[]>([]);
    const [editOverheads, setEditOverheads] = useState<RecipeOverheadDetail[]>([]);
    const [isExporting, setIsExporting] = useState(false);
    const exportRef = React.useRef<HTMLDivElement>(null);

    const fetchRecipe = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('recipes')
                .select(`
                    *,
                    recipe_ingredients (
                        id,
                        ingredient_id,
                        quantity,
                        unit,
                        ingredients (
                            name,
                            buy_price,
                            buy_quantity,
                            buy_unit,
                            weight_per_unit
                        )
                    ),
                    recipe_overheads (
                        id,
                        name,
                        cost,
                        category
                    )
                `)
                .eq('id', recipeId)
                .single();

            if (error) throw error;

            if (data) {
                let ingredientsCost = 0;
                data.recipe_ingredients?.forEach((ri: any) => {
                    if (ri.ingredients) {
                        const ing = ri.ingredients;
                        const pricePerBaseUnit = ing.buy_price / ing.buy_quantity;
                        if (ing.buy_unit === 'kg' && ri.unit === 'gr') ingredientsCost += ri.quantity * (pricePerBaseUnit / 1000);
                        else if (ing.buy_unit === 'L' && ri.unit === 'ml') ingredientsCost += ri.quantity * (pricePerBaseUnit / 1000);
                        else if (ing.buy_unit === ri.unit) ingredientsCost += ri.quantity * pricePerBaseUnit;
                        else ingredientsCost += ri.quantity * pricePerBaseUnit;
                    }
                });

                const overheadsCost = data.recipe_overheads?.reduce((sum: number, oh: any) => sum + Number(oh.cost), 0) || 0;

                const recipeData: RecipeData = {
                    ...data,
                    total_hpp: ingredientsCost + overheadsCost,
                };
                setRecipe(recipeData);
                setEditForm({
                    name: recipeData.name,
                    category: recipeData.category,
                    portions: recipeData.portions,
                    margin_percentage: recipeData.margin_percentage,
                });
            }
        } catch (error) {
            console.error('Fetch recipe failed:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRecipe();
    }, [recipeId]);

    const startEditing = () => {
        if (!recipe) return;
        setIsEditing(true);
        setEditForm({
            name: recipe.name,
            category: recipe.category,
            portions: recipe.portions,
            margin_percentage: recipe.margin_percentage,
        });
        // Populate edit ingredients from current recipe data
        setEditIngredients(
            (recipe.recipe_ingredients || []).map((ri, idx) => ({
                tempId: ri.id || `existing-${idx}`,
                ingredientId: ri.ingredient_id,
                quantity: ri.quantity,
                unit: ri.unit as Unit,
            }))
        );
        setEditOverheads(
            (recipe.recipe_overheads || []).map(oh => ({ ...oh }))
        );
    };

    const cancelEditing = () => {
        setIsEditing(false);
    };

    // Ingredient editing helpers
    const addIngredientRow = () => {
        setEditIngredients([
            ...editIngredients,
            { tempId: `new-${Date.now()}`, ingredientId: '', quantity: 0, unit: 'gr' as Unit }
        ]);
    };

    const removeIngredientRow = (tempId: string) => {
        setEditIngredients(editIngredients.filter(r => r.tempId !== tempId));
    };

    const updateIngredientRow = (tempId: string, data: Partial<EditIngredientRow>) => {
        setEditIngredients(editIngredients.map(r => r.tempId === tempId ? { ...r, ...data } : r));
    };

    // Overhead editing helpers
    const addOverheadRow = () => {
        setEditOverheads([
            ...editOverheads,
            { name: '', cost: 0, category: 'Lainnya' }
        ]);
    };

    const removeOverheadRow = (idx: number) => {
        setEditOverheads(editOverheads.filter((_, i) => i !== idx));
    };

    const updateOverheadRow = (idx: number, data: Partial<RecipeOverheadDetail>) => {
        setEditOverheads(editOverheads.map((r, i) => i === idx ? { ...r, ...data } : r));
    };

    // Calculate costs from edit state for live preview
    const editIngredientsCost = editIngredients.reduce((sum, item) => {
        const ing = availableIngredients.find(i => i.id === item.ingredientId);
        if (!ing || !item.quantity) return sum;
        const pricePerBaseUnit = ing.buyPrice / ing.buyQuantity;
        if (ing.buyUnit === 'kg' && item.unit === 'gr') return sum + item.quantity * (pricePerBaseUnit / 1000);
        if (ing.buyUnit === 'L' && item.unit === 'ml') return sum + item.quantity * (pricePerBaseUnit / 1000);
        return sum + item.quantity * pricePerBaseUnit;
    }, 0);

    const editOverheadsCost = editOverheads.reduce((sum, oh) => sum + (oh.cost || 0), 0);
    const editTotalHpp = editIngredientsCost + editOverheadsCost;
    const editHppPerUnit = editForm.portions > 0 ? editTotalHpp / editForm.portions : 0;
    const editSellingPrice = Math.ceil(editHppPerUnit * (1 + editForm.margin_percentage / 100) / 100) * 100;
    const editProfitPerUnit = editSellingPrice - editHppPerUnit;

    const getIngredientCost = (ri: RecipeIngredientDetail) => {
        if (!ri.ingredients) return 0;
        const ing = ri.ingredients;
        const pricePerBaseUnit = ing.buy_price / ing.buy_quantity;
        if (ing.buy_unit === 'kg' && ri.unit === 'gr') return ri.quantity * (pricePerBaseUnit / 1000);
        if (ing.buy_unit === 'L' && ri.unit === 'ml') return ri.quantity * (pricePerBaseUnit / 1000);
        return ri.quantity * pricePerBaseUnit;
    };

    const handleSaveEdit = async () => {
        if (!recipe) return;
        setIsSaving(true);
        try {
            // 1. Update basic recipe info
            const { error: recipeError } = await supabase
                .from('recipes')
                .update({
                    name: editForm.name,
                    category: editForm.category,
                    portions: editForm.portions,
                    margin_percentage: editForm.margin_percentage,
                })
                .eq('id', recipe.id);

            if (recipeError) throw recipeError;

            // 2. Delete all existing recipe_ingredients, then re-insert
            const { error: deleteIngError } = await supabase
                .from('recipe_ingredients')
                .delete()
                .eq('recipe_id', recipe.id);

            if (deleteIngError) throw deleteIngError;

            const validIngredients = editIngredients.filter(r => r.ingredientId && r.quantity > 0);
            if (validIngredients.length > 0) {
                const { error: insertIngError } = await supabase
                    .from('recipe_ingredients')
                    .insert(validIngredients.map(r => ({
                        recipe_id: recipe.id,
                        ingredient_id: r.ingredientId,
                        quantity: r.quantity,
                        unit: r.unit,
                    })));

                if (insertIngError) throw insertIngError;
            }

            // 3. Delete all existing recipe_overheads, then re-insert
            const { error: deleteOhError } = await supabase
                .from('recipe_overheads')
                .delete()
                .eq('recipe_id', recipe.id);

            if (deleteOhError) throw deleteOhError;

            const validOverheads = editOverheads.filter(o => o.name && o.cost > 0);
            if (validOverheads.length > 0) {
                const { error: insertOhError } = await supabase
                    .from('recipe_overheads')
                    .insert(validOverheads.map(o => ({
                        recipe_id: recipe.id,
                        name: o.name,
                        cost: o.cost,
                        category: o.category,
                    })));

                if (insertOhError) throw insertOhError;
            }

            await fetchRecipe();
            setIsEditing(false);
        } catch (error) {
            console.error('Update failed:', error);
            alert('Gagal mengupdate resep.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleExport = async (format: 'png' | 'pdf') => {
        if (!exportRef.current || !recipe) return;
        setIsExporting(true);

        try {
            const dataUrl = await htmlToImage.toPng(exportRef.current, {
                quality: 0.95,
                backgroundColor: '#ffffff',
                pixelRatio: 2
            });

            if (format === 'png') {
                const link = document.createElement('a');
                link.download = `HPP-${recipe.name}-${new Date().getTime()}.png`;
                link.href = dataUrl;
                link.click();
            } else {
                const pdf = new jsPDF('p', 'mm', 'a4');
                const imgWidth = 210;
                pdf.addImage(dataUrl, 'PNG', 0, 0, imgWidth, 0);
                pdf.save(`HPP-${recipe.name}-${new Date().getTime()}.pdf`);
            }
        } catch (error) {
            console.error('Export failed:', error);
            alert('Gagal mengunduh laporan.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleDelete = async () => {
        if (!recipe) return;
        if (!confirm('Hapus resep ini secara permanen?')) return;
        try {
            const { error } = await supabase.from('recipes').delete().eq('id', recipe.id);
            if (error) throw error;
            onBack();
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Gagal menghapus resep.');
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 animate-pulse">
                <LucideChefHat className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Memuat detail resep...</p>
            </div>
        );
    }

    if (!recipe) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <p className="text-sm text-muted-foreground">Resep tidak ditemukan.</p>
                <button onClick={onBack} className="mt-4 text-sm underline text-muted-foreground hover:text-foreground">Kembali</button>
            </div>
        );
    }

    // View mode values
    const hppPerUnit = (recipe.total_hpp || 0) / recipe.portions;
    const sellingPrice = Math.ceil(hppPerUnit * (1 + recipe.margin_percentage / 100) / 100) * 100;
    const profitPerUnit = sellingPrice - hppPerUnit;

    // Which values to show in the summary sidebar
    const displayTotalHpp = isEditing ? editTotalHpp : (recipe.total_hpp || 0);
    const displayHppPerUnit = isEditing ? editHppPerUnit : hppPerUnit;
    const displayMargin = isEditing ? editForm.margin_percentage : recipe.margin_percentage;
    const displaySellingPrice = isEditing ? editSellingPrice : sellingPrice;
    const displayProfit = isEditing ? editProfitPerUnit : profitPerUnit;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="h-9 w-9 flex items-center justify-center rounded-md border hover:bg-muted transition-colors"
                    >
                        <LucideArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">
                            {isEditing ? 'Edit Resep' : 'Detail Resep'}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            {isEditing ? 'Ubah informasi dan komposisi resep produk Anda' : 'Rincian lengkap kalkulasi HPP produk'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                onClick={cancelEditing}
                                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                            >
                                <LucideX className="h-4 w-4 mr-2" />
                                Batal
                            </button>
                            <button
                                onClick={handleSaveEdit}
                                disabled={isSaving}
                                className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90 transition-opacity dark:bg-zinc-50 dark:text-zinc-900 disabled:opacity-50"
                            >
                                <LucideSave className="h-4 w-4 mr-2" />
                                {isSaving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={startEditing}
                                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                            >
                                <LucidePencil className="h-4 w-4 mr-2" />
                                Edit
                            </button>
                            <button
                                onClick={handleDelete}
                                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-red-500 shadow-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            >
                                <LucideTrash2 className="h-4 w-4 mr-2" />
                                Hapus
                            </button>
                            <button
                                onClick={() => handleExport('png')}
                                disabled={isExporting}
                                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                            >
                                <LucideDownload className="h-4 w-4 mr-2" />
                                {isExporting ? 'Exporting...' : 'Export'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Basic Info Card */}
                    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                        <div className="flex flex-col space-y-1.5 p-6 border-b">
                            <h3 className="font-semibold leading-none tracking-tight">Informasi Produk</h3>
                            <p className="text-sm text-muted-foreground">Detail nama, kategori, dan porsi produk.</p>
                        </div>
                        <div className="p-6">
                            {isEditing ? (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium leading-none">Nama Produk</label>
                                        <input
                                            type="text"
                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            value={editForm.name}
                                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium leading-none">Kategori</label>
                                            <select
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                value={editForm.category}
                                                onChange={e => setEditForm({ ...editForm, category: e.target.value as 'Makanan' | 'Minuman' })}
                                            >
                                                <option value="Makanan">Makanan</option>
                                                <option value="Minuman">Minuman</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium leading-none">Porsi per Batch</label>
                                            <input
                                                type="number"
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                value={editForm.portions || ''}
                                                onChange={e => setEditForm({ ...editForm, portions: Number(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium leading-none">Margin (%)</label>
                                        <input
                                            type="number"
                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            value={editForm.margin_percentage || ''}
                                            onChange={e => setEditForm({ ...editForm, margin_percentage: Number(e.target.value) })}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                            <LucidePackage className="h-3 w-3" /> Produk
                                        </p>
                                        <p className="text-lg font-bold">{recipe.name}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                            {recipe.category === 'Makanan' ? <LucideUtensils className="h-3 w-3" /> : <LucideCoffee className="h-3 w-3" />} Kategori
                                        </p>
                                        <p className="text-lg font-bold">{recipe.category}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                            <LucideChefHat className="h-3 w-3" /> Porsi
                                        </p>
                                        <p className="text-lg font-bold">{recipe.portions} Porsi</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                            <LucideCalendar className="h-3 w-3" /> Dibuat
                                        </p>
                                        <p className="text-sm font-semibold">{new Date(recipe.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Ingredients Card */}
                    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                        <div className="flex flex-row items-center justify-between p-6 border-b">
                            <div className="space-y-1.5">
                                <h3 className="font-semibold leading-none tracking-tight flex items-center gap-2">
                                    <LucideUtensils className="h-4 w-4 text-muted-foreground" />
                                    Komposisi Bahan
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {isEditing
                                        ? `${editIngredients.length} bahan — klik Add untuk menambah.`
                                        : `${recipe.recipe_ingredients?.length || 0} bahan baku digunakan.`
                                    }
                                </p>
                            </div>
                            {isEditing && (
                                <button
                                    onClick={addIngredientRow}
                                    className="inline-flex h-8 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white shadow hover:opacity-90 transition-opacity dark:bg-zinc-50 dark:text-zinc-900"
                                >
                                    <LucidePlus className="h-3 w-3 mr-1" />
                                    Add
                                </button>
                            )}
                        </div>
                        <div className="p-6">
                            {isEditing ? (
                                <div className="space-y-3">
                                    {editIngredients.length === 0 ? (
                                        <div className="py-8 text-center border-2 border-dashed rounded-lg text-muted-foreground text-sm flex flex-col items-center">
                                            <LucidePlus className="h-6 w-6 mb-2 opacity-20" />
                                            Klik Add untuk menambah bahan baku
                                        </div>
                                    ) : (
                                        editIngredients.map((item) => {
                                            const selectedIng = availableIngredients.find(i => i.id === item.ingredientId);
                                            // Calculate per-row cost
                                            let rowCost = 0;
                                            if (selectedIng && item.quantity > 0) {
                                                const ppu = selectedIng.buyPrice / selectedIng.buyQuantity;
                                                if (selectedIng.buyUnit === 'kg' && item.unit === 'gr') rowCost = item.quantity * (ppu / 1000);
                                                else if (selectedIng.buyUnit === 'L' && item.unit === 'ml') rowCost = item.quantity * (ppu / 1000);
                                                else rowCost = item.quantity * ppu;
                                            }

                                            return (
                                                <div key={item.tempId} className="flex flex-col md:flex-row gap-3 p-4 rounded-lg bg-muted/30 border">
                                                    <div className="flex-1">
                                                        <select
                                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                            value={item.ingredientId}
                                                            onChange={e => updateIngredientRow(item.tempId, { ingredientId: e.target.value })}
                                                        >
                                                            <option value="">Pilih bahan...</option>
                                                            {availableIngredients.map(ing => (
                                                                <option key={ing.id} value={ing.id}>{ing.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            className="flex h-9 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                            placeholder="Qty"
                                                            value={item.quantity || ''}
                                                            onChange={e => updateIngredientRow(item.tempId, { quantity: Number(e.target.value) })}
                                                        />
                                                        <select
                                                            className="flex h-9 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                            value={item.unit}
                                                            onChange={e => updateIngredientRow(item.tempId, { unit: e.target.value as Unit })}
                                                        >
                                                            <option value="gr">gram</option>
                                                            <option value="kg">kg</option>
                                                            <option value="ml">ml</option>
                                                            <option value="L">L</option>
                                                            <option value="pcs">pcs</option>
                                                        </select>
                                                        <span className="text-xs font-semibold text-muted-foreground w-24 text-right hidden md:block">
                                                            Rp {rowCost.toLocaleString('id-ID')}
                                                        </span>
                                                        <button
                                                            onClick={() => removeIngredientRow(item.tempId)}
                                                            className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-all border shrink-0"
                                                        >
                                                            <LucideTrash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                    <div className="pt-4 border-t flex justify-between items-baseline">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subtotal Bahan</span>
                                        <span className="text-lg font-bold">Rp {editIngredientsCost.toLocaleString('id-ID')}</span>
                                    </div>
                                </div>
                            ) : (
                                /* View mode table */
                                <div className="-mx-6 -mb-6">
                                    <table className="w-full caption-bottom text-sm">
                                        <thead className="[&_tr]:border-b bg-muted/50">
                                            <tr className="border-b transition-colors">
                                                <th className="h-12 px-6 text-left align-middle font-medium text-muted-foreground">Bahan</th>
                                                <th className="h-12 px-6 text-left align-middle font-medium text-muted-foreground">Kuantitas</th>
                                                <th className="h-12 px-6 text-right align-middle font-medium text-muted-foreground">Biaya</th>
                                            </tr>
                                        </thead>
                                        <tbody className="[&_tr:last-child]:border-0">
                                            {recipe.recipe_ingredients?.map((ri, idx) => (
                                                <tr key={idx} className="border-b transition-colors hover:bg-muted/50">
                                                    <td className="p-6 align-middle font-medium">{ri.ingredients?.name || 'Unknown'}</td>
                                                    <td className="p-6 align-middle">
                                                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold border">
                                                            {ri.quantity} {ri.unit}
                                                        </span>
                                                    </td>
                                                    <td className="p-6 align-middle text-right font-semibold">
                                                        Rp {getIngredientCost(ri).toLocaleString('id-ID')}
                                                    </td>
                                                </tr>
                                            ))}
                                            {(!recipe.recipe_ingredients || recipe.recipe_ingredients.length === 0) && (
                                                <tr>
                                                    <td colSpan={3} className="p-6 text-center text-muted-foreground italic">Tidak ada data bahan.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Overheads Card */}
                    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                        <div className="flex flex-row items-center justify-between p-6 border-b">
                            <div className="space-y-1.5">
                                <h3 className="font-semibold leading-none tracking-tight flex items-center gap-2">
                                    <LucideZap className="h-4 w-4 text-muted-foreground" />
                                    Biaya Overhead
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {isEditing
                                        ? `${editOverheads.length} biaya — klik Add untuk menambah.`
                                        : `${recipe.recipe_overheads?.length || 0} biaya operasional.`
                                    }
                                </p>
                            </div>
                            {isEditing && (
                                <button
                                    onClick={addOverheadRow}
                                    className="inline-flex h-8 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white shadow hover:opacity-90 transition-opacity dark:bg-zinc-50 dark:text-zinc-900"
                                >
                                    <LucidePlus className="h-3 w-3 mr-1" />
                                    Add
                                </button>
                            )}
                        </div>
                        <div className="p-6">
                            {isEditing ? (
                                <div className="space-y-3">
                                    {editOverheads.length === 0 ? (
                                        <div className="py-8 text-center border-2 border-dashed rounded-lg text-muted-foreground text-sm flex flex-col items-center">
                                            <LucideZap className="h-6 w-6 mb-2 opacity-20" />
                                            Belum ada biaya overhead
                                        </div>
                                    ) : (
                                        editOverheads.map((o, idx) => (
                                            <div key={idx} className="flex flex-col md:flex-row gap-3 p-4 rounded-lg bg-muted/30 border">
                                                <div className="flex-1">
                                                    <input
                                                        type="text"
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        placeholder="Nama biaya"
                                                        value={o.name}
                                                        onChange={e => updateOverheadRow(idx, { name: e.target.value })}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        className="flex h-9 w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        value={o.category}
                                                        onChange={e => updateOverheadRow(idx, { category: e.target.value })}
                                                    >
                                                        <option value="Energi">Energi</option>
                                                        <option value="Kemasan">Kemasan</option>
                                                        <option value="Tenaga Kerja">Tenaga Kerja</option>
                                                        <option value="Lainnya">Lainnya</option>
                                                    </select>
                                                    <div className="relative">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-semibold">Rp</span>
                                                        <input
                                                            type="number"
                                                            className="flex h-9 w-32 rounded-md border border-input bg-background pl-8 pr-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                            placeholder="Cost"
                                                            value={o.cost || ''}
                                                            onChange={e => updateOverheadRow(idx, { cost: Number(e.target.value) })}
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => removeOverheadRow(idx)}
                                                        className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-all border shrink-0"
                                                    >
                                                        <LucideTrash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                    <div className="pt-4 border-t flex justify-between items-baseline">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subtotal Overhead</span>
                                        <span className="text-lg font-bold">Rp {editOverheadsCost.toLocaleString('id-ID')}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="-mx-6 -mb-6">
                                    {recipe.recipe_overheads && recipe.recipe_overheads.length > 0 ? (
                                        <table className="w-full caption-bottom text-sm">
                                            <thead className="[&_tr]:border-b bg-muted/50">
                                                <tr className="border-b transition-colors">
                                                    <th className="h-12 px-6 text-left align-middle font-medium text-muted-foreground">Item</th>
                                                    <th className="h-12 px-6 text-left align-middle font-medium text-muted-foreground">Kategori</th>
                                                    <th className="h-12 px-6 text-right align-middle font-medium text-muted-foreground">Biaya</th>
                                                </tr>
                                            </thead>
                                            <tbody className="[&_tr:last-child]:border-0">
                                                {recipe.recipe_overheads.map((oh, idx) => (
                                                    <tr key={idx} className="border-b transition-colors hover:bg-muted/50">
                                                        <td className="p-6 align-middle font-medium">{oh.name}</td>
                                                        <td className="p-6 align-middle">
                                                            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold border">
                                                                {oh.category}
                                                            </span>
                                                        </td>
                                                        <td className="p-6 align-middle text-right font-semibold">
                                                            Rp {Number(oh.cost).toLocaleString('id-ID')}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="p-6 text-center text-muted-foreground italic text-sm">Tidak ada biaya overhead.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column - Calculation Summary */}
                <div className="space-y-6">
                    <div className="sticky top-20 space-y-6">
                        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                            <div className="flex flex-col space-y-1.5 p-6 border-b">
                                <h3 className="font-semibold leading-none tracking-tight flex items-center gap-2">
                                    <LucideTrendingUp className="h-4 w-4 text-muted-foreground" />
                                    Ringkasan Kalkulasi
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {isEditing ? 'Preview kalkulasi real-time.' : 'Hasil akhir perhitungan HPP.'}
                                </p>
                            </div>
                            <div className="p-6 space-y-5">
                                <div className="flex justify-between items-baseline border-b pb-3">
                                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total HPP Batch</span>
                                    <span className="text-lg font-semibold">Rp {displayTotalHpp.toLocaleString('id-ID')}</span>
                                </div>
                                <div className="flex justify-between items-baseline border-b pb-3">
                                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">HPP / Unit</span>
                                    <span className="text-xl font-bold">Rp {displayHppPerUnit.toLocaleString('id-ID')}</span>
                                </div>
                                <div className="flex justify-between items-baseline border-b pb-3">
                                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Margin</span>
                                    <span className="text-lg font-bold">{displayMargin}%</span>
                                </div>

                                {/* Recommended Price */}
                                <div className="p-5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 shadow-lg text-center space-y-1">
                                    <p className="text-[10px] font-medium uppercase tracking-widest opacity-60">Harga Jual Rekomendasi</p>
                                    <h4 className="text-3xl font-bold">Rp {displaySellingPrice.toLocaleString('id-ID')}</h4>
                                </div>

                                <div className="flex justify-between items-center text-xs pt-2">
                                    <span className="text-muted-foreground">Estimasi Profit / Unit</span>
                                    <span className="font-bold text-green-600">+ Rp {displayProfit.toLocaleString('id-ID')}</span>
                                </div>

                                <div className="flex flex-col gap-2 pt-2">
                                    {isEditing && (
                                        <button
                                            onClick={handleSaveEdit}
                                            disabled={isSaving}
                                            className="w-full h-10 rounded-md bg-zinc-900 border border-zinc-900 dark:bg-zinc-50 dark:border-zinc-50 text-white dark:text-zinc-900 text-sm font-medium shadow hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                                        >
                                            <LucideSave className="h-4 w-4" />
                                            {isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleExport('png')}
                                        disabled={isExporting}
                                        className="w-full h-10 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <LucideDownload className="h-4 w-4" />
                                        {isExporting ? 'Exporting...' : 'Download Laporan'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl border bg-muted/50 border-dashed text-center">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Pastikan harga bahan baku di inventaris selalu ter-update agar kalkulasi HPP tetap akurat.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hidden Export Template */}
            <div className="fixed -left-[9999px] top-0 overflow-hidden pointer-events-none">
                <div ref={exportRef}>
                    <ExportTemplate
                        recipeName={isEditing ? editForm.name : recipe?.name || ''}
                        category={isEditing ? editForm.category : recipe?.category || 'Makanan'}
                        portions={isEditing ? editForm.portions : recipe?.portions || 1}
                        ingredients={isEditing
                            ? editIngredients.map(ei => ({ ingredientId: ei.ingredientId, quantity: ei.quantity, unit: ei.unit }))
                            : (recipe?.recipe_ingredients || []).map(ri => ({
                                ingredientId: ri.ingredient_id,
                                quantity: ri.quantity,
                                unit: ri.unit as any
                            }))}
                        availableIngredients={availableIngredients}
                        overheads={isEditing
                            ? editOverheads.map(eo => ({ name: eo.name, cost: eo.cost, category: eo.category }))
                            : (recipe?.recipe_overheads || []).map(oh => ({
                                name: oh.name,
                                cost: oh.cost,
                                category: oh.category
                            }))}
                        margin={displayMargin}
                        totalHPP={displayTotalHpp}
                        hppPerPortion={displayHppPerUnit}
                        sellingPrice={displaySellingPrice}
                    />
                </div>
            </div>
        </div>
    );
}
