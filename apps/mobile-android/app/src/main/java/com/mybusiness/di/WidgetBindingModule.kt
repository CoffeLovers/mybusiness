package com.mybusiness.di

import com.mybusiness.feature.widget.data.DashboardWidgetCache
import com.mybusiness.feature.widget.data.DashboardWidgetCacheImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Puentea la implementación de la cache del widget (`:feature:widget`) con su contrato,
 * requerido por los `@EntryPoint` del módulo (tile, Glance y `DashboardWidgetWorker`).
 *
 * Se declara en `:app` para no acoplar el módulo de feature a la capa de composición de
 * dependencias y porque Hilt sólo agrega los módulos de librerías que lo declaran.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class WidgetBindingModule {

    @Binds
    @Singleton
    abstract fun bindDashboardWidgetCache(
        impl: DashboardWidgetCacheImpl
    ): DashboardWidgetCache
}
