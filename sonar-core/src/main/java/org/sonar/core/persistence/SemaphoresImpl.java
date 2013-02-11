/*
 * Sonar, open source software quality management tool.
 * Copyright (C) 2008-2012 SonarSource
 * mailto:contact AT sonarsource DOT com
 *
 * Sonar is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * Sonar is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with Sonar; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02
 */
package org.sonar.core.persistence;

import org.sonar.api.utils.Semaphores;

/**
 * @since 3.4
 */
public class SemaphoresImpl implements Semaphores {

  private SemaphoreDao dao;
  private SemaphoreUpdater updater;

  public SemaphoresImpl(SemaphoreDao dao, SemaphoreUpdater updater) {
    this.dao = dao;
    this.updater = updater;
  }

  public Semaphore acquire(String name, int maxAgeInSeconds, int updatePeriodInSeconds) {
    Semaphore semaphore = dao.acquire(name, maxAgeInSeconds);
    updater.scheduleForUpdate(semaphore, updatePeriodInSeconds);
    return semaphore;
  }

  public Semaphore acquire(String name) {
    return dao.acquire(name);
  }

  public void release(String name) {
    updater.stopUpdate(name);
    dao.release(name);
  }
}
